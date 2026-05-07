import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient } from '@/lib/oauth/clients';
import { mintCode } from '@/lib/oauth/codes';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { consumeConsentTransaction } from '@/lib/oauth/consent-tx';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// Called by the consent page when Wes clicks Approve.
//
// p3-2 (Codex #7): the form posts ONLY a `tx` token. We atomically consume
// the row keyed by tx_id (single-use, 5-min TTL), pull every OAuth param
// from server-side state, and mint the code. The pre-p3-2 implementation
// trusted hidden form fields — a CSRF gadget that tricked Wes into POSTing
// to this endpoint with attacker-chosen client_id/redirect_uri could mint
// a code for the wrong client. That class of attack is now structurally
// impossible: even if the attacker fakes a tx value, they're either using
// a transaction THEY didn't initiate (so it doesn't grant THEIR client
// access) or they're guessing 32 bytes of entropy.
//
// Deny path: the consent page navigates back to / on Deny, so Approve is
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
  const { log, request_id } = loggerFor(req, { route: 'oauth/finalize' });

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
  const tx = form.get('tx');
  if (typeof tx !== 'string' || tx.length === 0) {
    log.warn('finalize POST missing tx');
    return new NextResponse('Missing consent transaction', { status: 400 });
  }

  // Atomically consume the transaction. After this returns, this tx_id
  // is permanently used — replay returns null, expired returns null.
  const transaction = await consumeConsentTransaction(tx);
  if (!transaction) {
    log.warn({ tx }, 'finalize tx not found / expired / replayed');
    // Generic message — don't reveal whether this was an unknown tx, an
    // expired tx, or a replay attempt.
    return new NextResponse('Consent transaction unknown or expired. Restart authorization.', { status: 400 });
  }

  const { client_id, redirect_uri, code_challenge, scope, state, subject } = transaction;

  // Defense-in-depth: even though authorize already validated, re-check
  // the client + redirect at finalize time. Catches the rare case where
  // a client was deleted or had its redirect_uris changed between
  // authorize and consent.
  const client = await findClient(client_id);
  if (!client) {
    log.warn({ tx, client_id }, 'finalize client missing at consume time');
    return new NextResponse('Unknown client', { status: 400 });
  }
  if (client.revoked_at) {
    log.warn({ tx, client_id }, 'finalize client revoked between authorize and consent');
    return new NextResponse('Client revoked', { status: 400 });
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    log.warn({ tx, client_id }, 'finalize redirect_uri mismatch at consume time');
    return new NextResponse('redirect_uri no longer matches', { status: 400 });
  }

  let code: string;
  try {
    code = await mintCode({
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method: 'S256',
      scope,
      // session.sub is the authenticated approver; transaction.subject was
      // stamped at authorize time. They should match for this single-tenant
      // app — but trust the session value here since it's the live identity.
      subject: session.sub || subject,
      state,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'oauth/finalize', client_id });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'mintCode failed');
    return redirectWithError(redirect_uri, 'server_error', 'code mint failed', state);
  }

  log.info({ client_id, outcome: 'approved' }, 'oauth code minted');

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url, { status: 303 });
}
