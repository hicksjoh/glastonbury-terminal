// Session tokens — signed JWTs via jose (Edge runtime compatible).
//
// Replaces the legacy gt-auth cookie which was `sha256("gt:" + APP_PASSWORD)`
// — a static value that never rotated and couldn't be revoked. Any cookie
// capture (XSS, shoulder-surf, leaked devtools screenshot) granted 30 days
// of access. This module issues real signed JWTs with iat/exp claims and
// makes "rotate SESSION_SECRET" a one-command session purge.
//
// Env contract:
//   SESSION_SECRET — server-only, ≥32 chars. Rotating this invalidates
//     every outstanding session immediately. Must be set in production.
//     In development (NODE_ENV !== 'production') a predictable fallback
//     is used so local dev works out of the box.
//   APP_PASSWORD is still used by /api/auth/login to authenticate; this
//     module only deals with session state after login succeeds.

import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'gt-auth';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const ALG = 'HS256';

const DEV_FALLBACK_SECRET =
  'dev-only-change-me-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function encodedSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET must be set in production (≥32 chars of random entropy)',
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

export interface SessionPayload {
  /** Subject — always 'wes' for this single-user terminal. */
  sub: string;
}

/**
 * Signs a JWT for a freshly-authenticated session.
 * Issued-at and 30-day expiry are set automatically.
 */
export async function createSessionJwt(
  payload: SessionPayload,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(encodedSecret());
}

/**
 * Verifies a session JWT. Returns the payload on success or null if the
 * token is missing, malformed, expired, tampered, or signed with a
 * different secret. Never throws for token-level failures — rethrows
 * only on environment/config problems (missing secret in prod).
 */
export async function verifySessionJwt(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedSecret(), {
      algorithms: [ALG],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return { sub: payload.sub };
  } catch {
    // jose throws typed JOSEError subclasses for every token-level failure
    // (expired, malformed, signature mismatch, wrong alg, etc.). Treat all
    // of them as "invalid token, force re-login". We only rethrow if the
    // failure was from encodedSecret() — but that throws synchronously
    // before the try, so we never catch it here.
    return null;
  }
}
