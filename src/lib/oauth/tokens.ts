// OAuth access tokens — short-lived JWTs.
//
// We reuse the existing SESSION_SECRET (HS256) so there's only one secret
// to rotate. Session-cookie JWTs carry NO aud claim and are rejected by
// verifyAccessToken (which requires aud match); OAuth access tokens carry
// aud=<resource URL> (or, for legacy tokens minted before P0-2, the
// placeholder 'terminal-mcp'). P0-1 also rejects any JWT WITH an aud
// claim from session verification, so cross-replay in either direction
// is structurally impossible.
//
// Tokens are 1-hour. No refresh tokens in v1 — clients re-do the auth
// dance when expired. Claude.app handles this transparently.
//
// p2-1: every successful verify checks the oauth_clients row for
// revoked_at != NULL, so revoking a client makes every outstanding token
// inert immediately (no wait for the 1h JWT TTL).
//
// P0-2: tokens are RFC 8707-bound. The `aud` claim equals the resource
// URL the authorize request specified (typically `${issuer}/api/mcp`).
// verifyAccessToken accepts BOTH the new URL form AND the legacy
// 'terminal-mcp' placeholder so tokens issued during the rollout window
// don't break mid-flight. Once the rollout has soaked for >1h (token
// TTL), the legacy acceptance can be removed.

import { SignJWT, jwtVerify } from 'jose';
import { findClient, touchClientUsage } from '@/lib/oauth/clients';

const ALG = 'HS256';
const LEGACY_AUDIENCE = 'terminal-mcp';
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const DEV_FALLBACK_SECRET =
  'dev-only-change-me-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function encodedSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET must be set in production for OAuth tokens (≥32 chars)',
      );
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  if (raw.length < 32) {
    throw new Error(
      `SESSION_SECRET is only ${raw.length} chars; require ≥32 for HS256`,
    );
  }
  return new TextEncoder().encode(raw);
}

export interface AccessTokenPayload {
  sub: string;        // 'wes'
  client_id: string;  // OAuth client that requested it
  scope: string;      // 'mcp'
  /** RFC 8707 resource URL the token is bound to (mirrors `aud`). */
  resource: string;
}

export interface CreateAccessTokenInput {
  sub: string;
  client_id: string;
  scope: string;
  /**
   * RFC 8707 resource URL (typically `${issuer}/api/mcp`). When omitted
   * (legacy callers during P0-2 rollout window), the token is stamped
   * with the LEGACY_AUDIENCE placeholder. The flow should always supply
   * this once /api/oauth/authorize is post-P0-2.
   */
  resource?: string | null;
}

export async function createAccessToken(
  input: CreateAccessTokenInput,
): Promise<{ token: string; expires_in: number }> {
  const now = Math.floor(Date.now() / 1000);
  const audience = input.resource && input.resource.length > 0
    ? input.resource
    : LEGACY_AUDIENCE;
  const token = await new SignJWT({
    sub: input.sub,
    client_id: input.client_id,
    scope: input.scope,
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setAudience(audience)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(encodedSecret());
  return { token, expires_in: TOKEN_TTL_SECONDS };
}

/**
 * Verify an MCP Bearer access token. Returns the payload on success or
 * null on every failure mode (missing, malformed, expired, wrong aud,
 * tampered, wrong secret, revoked client).
 *
 * P0-2: pass `expectedResource` so the token is verified against the
 * actual resource URL the request is hitting (RFC 8707). When
 * `expectedResource` is omitted, the verifier still accepts tokens whose
 * `aud` is the LEGACY_AUDIENCE placeholder — this is the rollout
 * compatibility path; once all tokens issued pre-P0-2 expire (1h), the
 * legacy path can be removed.
 *
 * Adds one Supabase round-trip per MCP request to check revocation. ~10-30ms
 * on the warm path. If this becomes a bottleneck, cache (clientId →
 * revoked_at) for 30-60s — revocation propagates within the cache window.
 */
export async function verifyAccessToken(
  token: string | undefined | null,
  expectedResource?: string,
): Promise<AccessTokenPayload | null> {
  if (!token) return null;
  try {
    // We accept either the expected resource URL OR the legacy placeholder.
    // jose accepts a string[] for audience and matches against any.
    const acceptedAudiences: string[] = expectedResource
      ? [expectedResource, LEGACY_AUDIENCE]
      : [LEGACY_AUDIENCE];
    const { payload } = await jwtVerify(token, encodedSecret(), {
      algorithms: [ALG],
      audience: acceptedAudiences,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.client_id !== 'string' ||
      typeof payload.scope !== 'string'
    ) {
      return null;
    }

    // Resolve actual audience for the payload (jose verified the match but
    // we want it on the returned payload for callers that care).
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : (payload.aud ?? LEGACY_AUDIENCE);
    const resource = typeof aud === 'string' ? aud : LEGACY_AUDIENCE;

    // Revocation check. JWT signature was valid, but the client may have
    // been admin-revoked since the token was issued. We honor that here
    // rather than waiting for the JWT TTL to expire.
    const client = await findClient(payload.client_id);
    if (!client) return null;          // client deleted entirely
    if (client.revoked_at) return null; // client revoked

    // Best-effort usage timestamp. Don't await on the hot path —
    // touchClientUsage already swallows errors.
    void touchClientUsage(payload.client_id);

    return {
      sub: payload.sub,
      client_id: payload.client_id,
      scope: payload.scope,
      resource,
    };
  } catch {
    return null;
  }
}
