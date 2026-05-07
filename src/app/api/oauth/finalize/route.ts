import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient } from '@/lib/oauth/clients';
import { mintCode } from '@/lib/oauth/codes';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

// Called by the consent page when Wes clicks Approve. POSTs the OAuth
// params back, we validate them one more time (defence in depth), mint
// a code, and 303 redirect to the client's redirect_uri with code+state.
//
// Deny path: the consent page just navigates back to /, so Approve is
// the only thing that hits this endpoint.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectWithError(redirect_uri: string, error: string, error_description: string, state: string | null): NextResponse {
  const url = new URL(redirect_uri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', error_description);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest) {
  // p1-6: 10 mints per IP per minute. This route mints OAuth codes — the
  // tightest cap of the OAuth surface. A real human won't hit this more
  // than a handful of times per month.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-finalize', key, 10, 60);
  if (!allowed) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  // Auth check — only Wes can approve.
  const authCookie = req.cookies.get(SESSION_COOKIE_NAME);
  const session = await verifySessionJwt(authCookie?.value);
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const form = await req.formData();
  const client_id = form.get('client_id');
  const redirect_uri = form.get('redirect_uri');
  const code_challenge = form.get('code_challenge');
  const code_challenge_method = form.get('code_challenge_method');
  const scope = (form.get('scope') as string | null) ?? 'mcp';
  const state = (form.get('state') as string | null) ?? null;

  if (typeof client_id !== 'string' || typeof redirect_uri !== 'string') {
    return new NextResponse('Missing client_id or redirect_uri', { status: 400 });
  }

  const client = await findClient(client_id);
  if (!client) {
    return new NextResponse('Unknown client_id', { status: 400 });
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    return new NextResponse('redirect_uri does not match any registered URI', { status: 400 });
  }

  if (typeof code_challenge !== 'string' || code_challenge.length === 0) {
    return redirectWithError(redirect_uri, 'invalid_request', 'PKCE code_challenge required', state);
  }
  if (code_challenge_method !== 'S256') {
    return redirectWithError(redirect_uri, 'invalid_request', 'code_challenge_method must be S256', state);
  }
  if (scope !== 'mcp') {
    return redirectWithError(redirect_uri, 'invalid_scope', 'only "mcp" scope supported', state);
  }

  let code: string;
  try {
    code = await mintCode({
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method: 'S256',
      scope,
      subject: session.sub,
      state,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'mint failed';
    return redirectWithError(redirect_uri, 'server_error', msg, state);
  }

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url, { status: 303 });
}
