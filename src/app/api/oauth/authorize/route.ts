import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient } from '@/lib/oauth/clients';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { mintConsentTransaction } from '@/lib/oauth/consent-tx';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// RFC 6749 §4.1.1 Authorization Request.
//
// Validates the request parameters and routes the user toward consent:
//   - If not signed into the terminal: 302 → /login?next=<this URL>
//   - If signed in but params invalid: redirect back to client redirect_uri
//     with ?error=...&error_description=... per RFC 6749 §4.1.2.1
//   - If signed in and valid: mint a consent transaction (server-side
//     binding) and 302 → /oauth/consent?tx=<id> with ONLY the tx id.
//
// p3-2 (Codex #7): we no longer round-trip every authorize parameter
// through the consent UI's hidden form fields. The transaction ID is
// the only thing exposed; finalize loads the params server-side.

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
  const { log, request_id } = loggerFor(req, { route: 'oauth/authorize' });

  // p1-6: 30 attempts per IP per minute. Plenty of headroom for the legit
  // human flow (one click in Claude.app sends one request) but caps any
  // attacker spamming this endpoint with malformed params trying to learn
  // about registered clients via differential error responses.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-authorize', key, 30, 60);
  if (!allowed) {
    log.warn('authorize rate limit hit');
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
  // p6-1: revoked clients return the same "Unknown client_id" response so an
  // attacker can't differentiate "never registered" from "revoked." The real
  // reason is logged server-side for ops debugging.
  if (!client || client.revoked_at) {
    if (client?.revoked_at) {
      log.warn({ client_id }, 'authorize: client revoked');
    }
    return badRequest('Unknown client_id');
  }
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

  // Mint a server-side consent transaction. The tx_id is the only thing
  // we put in the URL — the consent page loads params from Supabase via
  // peekConsentTransaction(), and /api/oauth/finalize consumes the row
  // atomically. Hidden form fields are no longer load-bearing.
  let tx_id: string;
  try {
    tx_id = await mintConsentTransaction({
      client_id,
      redirect_uri,
      code_challenge: code_challenge as string,
      code_challenge_method: 'S256',
      scope,
      subject: session.sub,
      state: state ?? null,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'oauth/authorize', client_id });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'consent tx mint failed');
    // If we can't mint (Supabase outage), fail with a generic error rather
    // than redirecting to the client redirect_uri (which would expose a
    // sentinel error_description that could be used for fingerprinting).
    return badRequest('Internal error preparing consent');
  }

  log.info({ client_id, outcome: 'consent_tx_minted' }, 'authorize → consent');

  const consentUrl = new URL('/oauth/consent', req.url);
  consentUrl.searchParams.set('tx', tx_id);
  return NextResponse.redirect(consentUrl, { status: 303 });
}
