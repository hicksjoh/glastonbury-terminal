// OAuth access tokens — short-lived JWTs.
//
// We reuse the existing SESSION_SECRET (HS256) so there's only one secret
// to rotate, but stamp `aud: 'terminal-mcp'` on every OAuth token. The
// session-cookie verifier doesn't enforce audience (legacy code), but
// verifyAccessToken below DOES require aud='terminal-mcp', and the MCP
// route uses verifyAccessToken — so a session cookie can't be replayed
// as an MCP access token, and an MCP token can't be presented as a
// session cookie (different cookie name + signature won't matter because
// MCP tokens are presented as Bearer headers, never cookies).
//
// Tokens are 1-hour. No refresh tokens in v1 — clients re-do the auth
// dance when expired. Claude.app handles this transparently.

import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';
const AUDIENCE = 'terminal-mcp';
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
}

export async function createAccessToken(
  payload: AccessTokenPayload,
): Promise<{ token: string; expires_in: number }> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setAudience(AUDIENCE)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(encodedSecret());
  return { token, expires_in: TOKEN_TTL_SECONDS };
}

/**
 * Verify an MCP Bearer access token. Returns the payload on success or
 * null on every failure mode (missing, malformed, expired, wrong aud,
 * tampered, wrong secret).
 */
export async function verifyAccessToken(
  token: string | undefined | null,
): Promise<AccessTokenPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedSecret(), {
      algorithms: [ALG],
      audience: AUDIENCE,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.client_id !== 'string' ||
      typeof payload.scope !== 'string'
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      client_id: payload.client_id,
      scope: payload.scope,
    };
  } catch {
    return null;
  }
}
