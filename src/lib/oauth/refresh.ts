// OAuth refresh tokens — rotating, with reuse detection.
//
// Why this exists (2026-09-19 connector QA):
//   Access tokens are 1-hour JWTs and /api/oauth/token only implemented the
//   authorization_code grant. src/lib/oauth/tokens.ts claimed "no refresh
//   tokens in v1 — clients re-do the auth dance when expired. Claude.app
//   handles this transparently." It does not. What a client can do
//   transparently is spend a refresh token; what it cannot do is re-run a
//   flow that requires a human to log into the terminal and click Approve.
//   Without this, the connector went dead every hour and surfaced exactly
//   the message that started this investigation: "authentication expired."
//
// Design (OAuth 2.1 §4.3.1, RFC 6819 §5.2.2.3):
//   - Opaque 256-bit tokens, stored as SHA-256 hashes. The plaintext is
//     returned to the client once and never persisted, so database read
//     access alone cannot mint access tokens.
//   - ROTATION: every successful refresh consumes the presented token and
//     issues a new one. A leaked token is therefore useful for at most one
//     exchange.
//   - REUSE DETECTION: all tokens descended from one authorization grant
//     share a family_id. Presenting an already-rotated token means either an
//     attacker replayed a stolen token or the legitimate client lost the
//     response — indistinguishable, and both are handled the same way: burn
//     the whole family and force a fresh consent. That is the standard
//     response and it is deliberately unforgiving.
//
// Lifetime: 30 days, matching the terminal session cookie. Re-consent is a
// month apart instead of hourly.

import { createServiceClient } from '@/lib/supabase';

/** 30 days, matching SESSION_MAX_AGE_SECONDS in src/lib/session.ts. */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RefreshGrant {
  family_id: string;
  client_id: string;
  subject: string;
  scope: string;
  resource: string | null;
}

export interface MintRefreshInput {
  client_id: string;
  subject: string;
  scope: string;
  resource?: string | null;
  /** Omit to start a new family (fresh authorization_code grant). */
  family_id?: string;
}

export type RefreshFailure =
  | 'unknown'      // no such token
  | 'expired'
  | 'revoked'
  | 'reused';      // already rotated away — family burned

export type RefreshResult =
  | { ok: true; grant: RefreshGrant }
  | { ok: false; reason: RefreshFailure };

function randomToken(): string {
  const bytes = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/** SHA-256 hex. Edge/Node compatible via WebCrypto. */
export async function hashRefreshToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(digest);
  let s = '';
  for (let i = 0; i < arr.length; i++) {
    s += arr[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Mint a refresh token. Returns the plaintext — the ONLY time it exists
 * outside the client. Pass `family_id` to continue an existing family
 * (rotation); omit it to start a new one (fresh consent).
 */
export async function mintRefreshToken(
  input: MintRefreshInput,
): Promise<{ token: string; expires_at: string; family_id: string }> {
  const supabase = createServiceClient();
  const token = randomToken();
  const token_hash = await hashRefreshToken(token);
  const family_id = input.family_id ?? crypto.randomUUID();
  const expires_at = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

  const { error } = await supabase.from('oauth_refresh_tokens').insert({
    token_hash,
    family_id,
    client_id: input.client_id,
    subject: input.subject,
    scope: input.scope,
    resource: input.resource ?? null,
    expires_at,
  });
  if (error) {
    throw new Error(`oauth_refresh_tokens insert failed: ${error.message}`);
  }
  return { token, expires_at, family_id };
}

/**
 * Revoke every token in a family. Called on reuse detection and whenever a
 * client is revoked.
 */
export async function revokeRefreshFamily(family_id: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('revoke_refresh_family', {
    p_family_id: family_id,
  });
  if (error) {
    console.warn('[oauth] revokeRefreshFamily failed:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

/**
 * Revoke every refresh token held by a client. Used by the admin revoke
 * path so killing a client kills its ability to mint new access tokens,
 * not just the outstanding JWTs.
 */
export async function revokeRefreshTokensForClient(client_id: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('oauth_refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .is('revoked_at', null);
  } catch (err) {
    console.warn(
      '[oauth] revokeRefreshTokensForClient failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Atomically claim a refresh token for rotation.
 *
 * On success the presented token is marked used and the caller should mint
 * a successor in the same family. On failure the reason distinguishes an
 * unknown/expired/revoked token from genuine REUSE — and reuse burns the
 * entire family before returning, so a stolen token cannot outlive its
 * detection.
 */
export async function claimRefreshToken(token: string): Promise<RefreshResult> {
  const supabase = createServiceClient();
  const token_hash = await hashRefreshToken(token);

  const { data, error } = await supabase.rpc('claim_refresh_token', {
    p_token_hash: token_hash,
  });

  if (!error && data && (!Array.isArray(data) || data.length > 0)) {
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    return {
      ok: true,
      grant: {
        family_id: row.family_id as string,
        client_id: row.client_id as string,
        subject: row.subject as string,
        scope: row.scope as string,
        resource: (row.resource as string | null) ?? null,
      },
    };
  }

  // The claim did not land. Read the row back to find out why — this is the
  // difference between "your token aged out" and "someone is replaying a
  // token we already rotated away."
  const { data: row, error: readErr } = await supabase
    .from('oauth_refresh_tokens')
    .select('family_id, used_at, revoked_at, expires_at')
    .eq('token_hash', token_hash)
    .maybeSingle();

  if (readErr || !row) return { ok: false, reason: 'unknown' };

  const r = row as {
    family_id: string;
    used_at: string | null;
    revoked_at: string | null;
    expires_at: string;
  };

  if (r.used_at) {
    // REUSE. Either a stolen token is being replayed, or the legitimate
    // client never received the rotated successor. We cannot tell them
    // apart, so we assume compromise: burn the family. The user re-consents
    // once; an attacker gets nothing.
    await revokeRefreshFamily(r.family_id);
    return { ok: false, reason: 'reused' };
  }
  if (r.revoked_at) return { ok: false, reason: 'revoked' };
  if (Date.parse(r.expires_at) < Date.now()) return { ok: false, reason: 'expired' };

  // Claim failed but the row looks live — a concurrent claimer won the race.
  // Treat it as reuse: exactly one of the two racers gets the rotation.
  return { ok: false, reason: 'reused' };
}
