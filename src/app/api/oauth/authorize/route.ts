import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient } from '@/lib/oauth/clients';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

// RFC 6749 §4.1.1 Authorization Request.
//
// Validates the request parameters and routes the user toward consent:
//   - If not signed into the terminal: 302 → /login?next=<this URL>
//   - If signed in but params invalid: redirect back to client redirect_uri
//     with ?error=...&error_description=... per RFC 6749 §4.1.2.1
//   - If signed in and valid: 302 → /oauth/consent with all params preserved
//
// We never auto-mint codes here — the human must click Approve on the
// consent page first. That gives one extra layer of defense against a
// malicious client tricking Wes by chaining redirects.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AuthorizeError {
  error: string;
  error_description: string;
  state?: string | null;
}

function redirectWithError(redirect_uri: string, err: AuthorizeError): NextResponse {
  const url = new URL(redirect_uri);
  url.searchParams.set('error', err.error);
  url.searchParams.set('error_description', err.error_description);
  if (err.state) url.searchParams.set('state', err.state);
  return NextResponse.redirect(url, { status: 303 });
}

function badRequest(detail: string): NextResponse {
  return new NextResponse(detail, {
    status: 400,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function GET(req: NextRequest) {
  // p1-6: 30 attempts per IP per minute. Plenty of headroom for the legit
  // human flow (one click in Claude.app sends one request) but caps any
  // attacker spamming this endpoint with malformed params trying to learn
  // about registered clients via differential error responses.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-authorize', key, 30, 60);
  if (!allowed) {
    return new NextResponse('Too many requests', { status: 429 });
  }

  const { searchParams } = req.nextUrl;
  const response_type = searchParams.get('response_type');
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const code_challenge = searchParams.get('code_challenge');
  const code_challenge_method = searchParams.get('code_challenge_method');
  const scope = searchParams.get('scope') ?? 'mcp';
  const state = searchParams.get('state');

  // Pre-redirect validation: when client_id or redirect_uri are missing or
  // invalid we MUST NOT redirect to the (untrusted) redirect_uri — that's an
  // open-redirect. Render an error page instead. RFC 6749 §3.1.2.4.
  if (!client_id) return badRequest('Missing client_id');
  if (!redirect_uri) return badRequest('Missing redirect_uri');

  const client = await findClient(client_id);
  if (!client) return badRequest('Unknown client_id');
  if (!client.redirect_uris.includes(redirect_uri)) {
    return badRequest('redirect_uri does not match any registered URI for this client');
  }

  // Now we can safely redirect errors back to the client.
  if (response_type !== 'code') {
    return redirectWithError(redirect_uri, {
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported',
      state,
    });
  }
  if (!code_challenge) {
    return redirectWithError(redirect_uri, {
      error: 'invalid_request',
      error_description: 'PKCE code_challenge is required',
      state,
    });
  }
  if (code_challenge_method !== 'S256') {
    return redirectWithError(redirect_uri, {
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256',
      state,
    });
  }
  if (scope !== 'mcp') {
    return redirectWithError(redirect_uri, {
      error: 'invalid_scope',
      error_description: 'Only the "mcp" scope is supported',
      state,
    });
  }

  // Auth check — must have valid gt-auth session to consent. If not,
  // bounce to /login with a `next` that lands them back on this exact
  // /api/oauth/authorize URL after login. The consent page itself also
  // requires auth (middleware handles), so this is just to give a nice UX.
  const authCookie = req.cookies.get(SESSION_COOKIE_NAME);
  const session = await verifySessionJwt(authCookie?.value);
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  // Forward to consent page with the same params. The consent page reads
  // them, shows client info to Wes, and POSTs to /api/oauth/finalize.
  const consentUrl = new URL('/oauth/consent', req.url);
  for (const k of ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state']) {
    const v = searchParams.get(k);
    if (v !== null) consentUrl.searchParams.set(k, v);
  }
  return NextResponse.redirect(consentUrl, { status: 303 });
}
