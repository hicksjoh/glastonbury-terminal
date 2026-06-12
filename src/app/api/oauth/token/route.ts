import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { findClient, verifyClientSecret } from '@/lib/oauth/clients';
import { consumeCode } from '@/lib/oauth/codes';
import { verifyS256, isWellFormedVerifier } from '@/lib/oauth/pkce';
import { createAccessToken } from '@/lib/oauth/tokens';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { loggerFor } from '@/lib/request-id';
import { readBoundedText, BodyTooLargeError, BODY_LIMIT } from '@/lib/bounded-body';

// RFC 6749 §3.2 Token Endpoint, §4.1.3 Access Token Request.
//
// Accepts either application/x-www-form-urlencoded (the OAuth standard) or
// JSON (Claude.app and some other clients send JSON despite RFC 6749).
// Authentication: "none" (PKCE-only) or client_secret_post.
//
// Rate-limited so a stolen authorization code can't be brute-forced via
// PKCE verifier guessing. The PKCE verifier is 43-128 chars of entropy
// per RFC 7636, so even without the rate limit guessing is impossible —
// but defence in depth.
//
// p3-1: error responses are GENERIC. Pre-p3-1 the route returned distinct
// error_description strings ("Unknown client_id" vs "client_secret
// required" vs "client_secret mismatch") which let an attacker probe the
// registered-client table and learn confidential-vs-public clients via
// differential responses. Now: every client-identity failure returns the
// same body, every grant failure returns the same body. Real reasons are
// logged server-side via the structured logger.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenError(
  error: string,
  description: string,
  status = 400,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        ...extraHeaders,
      },
    },
  );
}

async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const ctype = (req.headers.get('content-type') ?? '').toLowerCase();
  const out: Record<string, string> = {};
  // p6-2: read at most 8KB of body — OAuth params are ~1KB total even with a
  // generous PKCE verifier. Throws BodyTooLargeError; caller handles 413.
  const text = await readBoundedText(req, BODY_LIMIT.SMALL);
  if (ctype.includes('application/json')) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') out[k] = v;
      }
    } catch {
      /* fall through */
    }
  } else {
    // application/x-www-form-urlencoded — parse manually so we don't reread the body.
    const params = new URLSearchParams(text);
    params.forEach((v, k) => { out[k] = v; });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const { log } = loggerFor(req, { route: 'oauth/token' });

  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('oauth-token', key, 30, 60);
  if (!allowed) {
    log.warn('token rate limit hit');
    return tokenError('rate_limited', 'Too many token requests', 429);
  }

  let params: Record<string, string>;
  try {
    params = await readParams(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      log.warn({ limit: err.limit }, 'token body too large');
      return tokenError('invalid_request', 'body too large', 413);
    }
    return tokenError('invalid_request', 'malformed body');
  }

  if (params.grant_type !== 'authorization_code') {
    return tokenError('unsupported_grant_type', 'Only authorization_code is supported');
  }

  const { code, redirect_uri, code_verifier, client_id, client_secret } = params;

  if (!code) return tokenError('invalid_request', 'code required');
  if (!redirect_uri) return tokenError('invalid_request', 'redirect_uri required');
  if (!code_verifier) return tokenError('invalid_request', 'code_verifier required');
  if (!client_id) return tokenError('invalid_request', 'client_id required');

  // P1-1: short-circuit a malformed PKCE verifier BEFORE we burn the
  // single-use code via consumeCode(). RFC 7636 §4.1 verifier shape.
  // Returns invalid_request (not invalid_grant) because this is a request
  // shape error, not a grant-validation failure.
  if (!isWellFormedVerifier(code_verifier)) {
    return tokenError('invalid_request', 'code_verifier shape invalid');
  }

  // P1-2: RFC 6749 §5.2 — return 401 ONLY when client authentication was
  // actually attempted. For public PKCE-only clients that don't send any
  // credential, return 400. This matters because standard OAuth libraries
  // (authlib, oauthlib) treat 401 as "retry with credentials" — they'll
  // never recover from a 401 if they had nothing to send in the first place.
  //
  // We don't support HTTP Basic for client auth (token_endpoint_auth_method
  // values are 'none' or 'client_secret_post' only), so "auth attempted" =
  // a client_secret arrived in the body.
  const authAttempted = typeof client_secret === 'string' && client_secret.length > 0;
  const invalidClient = (reason: string) => {
    log.warn({ client_id, reason, auth_attempted: authAttempted }, 'token invalid_client');
    if (authAttempted) {
      return tokenError(
        'invalid_client',
        'client authentication failed',
        401,
        // RFC 6749 §5.2 + RFC 6750 §3 — when returning 401 the server MUST
        // include a WWW-Authenticate matching the scheme the client used.
        // client_secret_post uses no Authorization header, but indicating
        // 'Basic'-style realm is the closest standard hint.
        { 'WWW-Authenticate': 'Basic realm="oauth-token", error="invalid_client"' },
      );
    }
    return tokenError('invalid_client', 'client authentication failed', 400);
  };

  const client = await findClient(client_id);
  if (!client) return invalidClient('unknown_client_id');
  // p6-1: collapse revoked clients into the same generic invalid_client
  // response so an attacker can't probe revocation status. /api/mcp's
  // verifyAccessToken already rejects revoked clients post-mint, but a
  // revoked client should never be ABLE to mint in the first place.
  if (client.revoked_at) return invalidClient('client_revoked');

  if (client.token_endpoint_auth_method === 'client_secret_post') {
    if (!client_secret) return invalidClient('client_secret_required');
    const ok = await verifyClientSecret(client, client_secret);
    if (!ok) return invalidClient('client_secret_mismatch');
  }
  // 'none' (PKCE public) — PKCE itself proves the requester started the flow.

  // ─── Generic invalid_grant response. Four formerly-distinct paths
  //     (consume failure / client mismatch / redirect mismatch / PKCE)
  //     collapse to one so attackers can't tell which check failed.
  const invalidGrant = (reason: string) => {
    log.warn({ client_id, reason }, 'token invalid_grant');
    return tokenError('invalid_grant', 'authorization grant invalid');
  };

  const row = await consumeCode(code);
  if (!row) return invalidGrant('consume_failed');
  if (row.client_id !== client_id) return invalidGrant('client_mismatch');
  if (row.redirect_uri !== redirect_uri) return invalidGrant('redirect_uri_mismatch');

  const pkceOk = await verifyS256(code_verifier, row.code_challenge);
  if (!pkceOk) return invalidGrant('pkce_failed');

  // P0-2: stamp `aud` with the resource URL recorded at authorize time.
  // Falls back to null → the legacy placeholder audience for any code
  // minted before the 20260514 migration backfilled the column. The
  // strict resource binding kicks in for all new codes.
  const { token, expires_in } = await createAccessToken({
    sub: row.subject,
    client_id,
    scope: row.scope,
    resource: row.resource,
  });

  return NextResponse.json(
    {
      access_token: token,
      token_type: 'Bearer',
      expires_in,
      scope: row.scope,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  );
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
