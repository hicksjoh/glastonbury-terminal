import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient } from '@/lib/oauth/clients';
import { mintCode, isCodeSpent } from '@/lib/oauth/codes';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import {
  consumeConsentTransaction,
  findReplayableConsentWithRetry,
  recordIssuedCode,
} from '@/lib/oauth/consent-tx';
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
//
// 2026-09-19 (connector QA): this route used to answer a DUPLICATE submit of
// the same tx with a bare-text 400. Production trace:
//   06:43:05  POST /api/oauth/finalize  303  code minted, redirecting to Claude
//   06:43:07  POST /api/oauth/finalize  400  same tx, 1.4s later
// The 400 replaced the in-flight cross-origin navigation, so the valid code
// minted two seconds earlier was never exchanged (oauth_codes.used_at stayed
// NULL) and the user read it as "authentication expired" right after logging
// in. Single-use consumption was never the bug — the dead end was.
//
// Now a duplicate submit re-issues the SAME redirect (see the replay path
// below), and the genuinely unrecoverable cases render a real HTML page that
// says what happened instead of a wall of plain text.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectWithError(redirect_uri: string, error: string, error_description: string, state: string | null): NextResponse {
  const url = new URL(redirect_uri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', error_description);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url, { status: 303 });
}

/** Build the client redirect carrying an authorization code. */
function redirectWithCode(redirect_uri: string, code: string, state: string | null): NextResponse {
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * A human is looking at this response in a browser tab — the consent form
 * posts here as a top-level navigation. Plain text told them nothing and
 * (worse) used the word "expired" for cases that were not expiry at all.
 */
function consentPage(opts: {
  status: number;
  title: string;
  body: string;
  tone: 'error' | 'ok';
}): NextResponse {
  const accent = opts.tone === 'ok' ? '#4ade80' : '#ff6b6b';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — Glastonbury Terminal</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08080d;padding:16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<div style="width:480px;max-width:100%;border:1px solid #2a2a3a;border-radius:16px;padding:32px;background:#1a1a24;color:#fff">
<h1 style="color:${accent};margin-top:0;font-size:22px">${escapeHtml(opts.title)}</h1>
<p style="color:#a0a0b0;line-height:1.6">${escapeHtml(opts.body)}</p>
<p style="margin-bottom:0"><a href="/" style="color:#7dd3fc;font-size:14px">Back to the terminal</a></p>
</div></body></html>`;
  return new NextResponse(html, {
    status: opts.status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    return consentPage({
      status: 401,
      tone: 'error',
      title: 'Not signed in',
      body: 'Your terminal session is not valid. Sign in again, then restart the connection from Claude.',
    });
  }

  const form = await req.formData();
  const tx = form.get('tx');
  if (typeof tx !== 'string' || tx.length === 0) {
    log.warn('finalize POST missing tx');
    return consentPage({
      status: 400,
      tone: 'error',
      title: 'Incomplete approval',
      body: 'This approval was submitted without a consent transaction. Restart the connection from Claude.',
    });
  }

  // Atomically consume the transaction. After this returns, this tx_id
  // is permanently used — a second consume returns null, expired returns null.
  const transaction = await consumeConsentTransaction(tx);
  if (!transaction) {
    // Before treating this as a failure, check whether it is the SAME
    // approval arriving twice. A double-click, a browser retry on the slow
    // cross-origin 303, or a restored tab all produce a second POST of a
    // transaction we already turned into a code. Re-issuing that same code
    // to the same already-validated redirect_uri is not a new grant — it is
    // re-delivering a result the user approved seconds ago.
    const replay = await findReplayableConsentWithRetry(tx);
    if (replay && replay.subject === session.sub) {
      // Re-validate the client and redirect on this path too: a replay must
      // not become a way to reach a redirect_uri that has since been
      // de-registered, or a client that has since been revoked.
      const replayClient = await findClient(replay.client_id);
      if (
        replayClient &&
        !replayClient.revoked_at &&
        replayClient.redirect_uris.includes(replay.redirect_uri)
      ) {
        // If the code was already exchanged the flow actually succeeded.
        // Bouncing a spent code back to the client would show the user a
        // spurious failure on a connector that is already working.
        if (await isCodeSpent(replay.issued_code)) {
          log.info({ tx, client_id: replay.client_id, outcome: 'replay_already_exchanged' }, 'finalize replay: grant already redeemed');
          return consentPage({
            status: 200,
            tone: 'ok',
            title: 'Already connected',
            body: 'You already approved this connection and Claude has picked it up. You can close this window.',
          });
        }
        log.info({ tx, client_id: replay.client_id, outcome: 'replay_reissued' }, 'finalize replay: re-issuing prior redirect');
        return redirectWithCode(replay.redirect_uri, replay.issued_code, replay.state);
      }
      log.warn({ tx, client_id: replay.client_id }, 'finalize replay rejected: client/redirect no longer valid');
    }

    log.warn({ tx }, 'finalize tx not found / expired / not replayable');
    // Generic wording — don't reveal whether this was an unknown tx, an
    // expired one, or a replay attempt by someone else.
    return consentPage({
      status: 400,
      tone: 'error',
      title: 'Approval link no longer valid',
      body: 'This approval link is unknown or older than five minutes. Restart the connection from Claude and approve within a few minutes.',
    });
  }

  const { client_id, redirect_uri, code_challenge, scope, state, subject, resource } = transaction;

  // Defense-in-depth: even though authorize already validated, re-check
  // the client + redirect at finalize time. Catches the rare case where
  // a client was deleted or had its redirect_uris changed between
  // authorize and consent.
  const client = await findClient(client_id);
  if (!client) {
    log.warn({ tx, client_id }, 'finalize client missing at consume time');
    return consentPage({
      status: 400,
      tone: 'error',
      title: 'Unknown application',
      body: 'The application that requested access is no longer registered on this terminal. Nothing was granted.',
    });
  }
  if (client.revoked_at) {
    log.warn({ tx, client_id }, 'finalize client revoked between authorize and consent');
    return consentPage({
      status: 400,
      tone: 'error',
      title: 'Application revoked',
      body: 'This application was revoked while you were on the consent screen. Nothing was granted.',
    });
  }
  if (!client.redirect_uris.includes(redirect_uri)) {
    log.warn({ tx, client_id }, 'finalize redirect_uri mismatch at consume time');
    return consentPage({
      status: 400,
      tone: 'error',
      title: 'Redirect no longer registered',
      body: 'The callback address on this request is no longer registered for that application. Nothing was granted.',
    });
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
      resource,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'oauth/finalize', client_id });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'mintCode failed');
    return redirectWithError(redirect_uri, 'server_error', 'code mint failed', state);
  }

  // Record the code against the transaction BEFORE redirecting, so a
  // duplicate submit that lands while the browser is still following this
  // 303 finds it and replays instead of erroring. Best-effort by design —
  // a failure here only costs the replay path, never this grant.
  await recordIssuedCode(tx, code);

  log.info({ client_id, outcome: 'approved' }, 'oauth code minted');

  return redirectWithCode(redirect_uri, code, state);
}
