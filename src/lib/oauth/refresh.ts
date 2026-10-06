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
//     share a family_id. Presenting a token that was rotated away, or one
//     that was revoked, burns the whole family and forces a fresh consent.
//   - RETRY GRACE: the one exception is the same client presenting a
//     just-rotated token again within 60s (lost response, parallel refresh).
//     See claimRefreshToken for how that is granted without forking the
//     family or blinding reuse detection.
//
// Lifetime: each token lasts 30 days from issue (idle timeout); a family
// lasts at most 90 days from its first token (absolute). Stays connected
// while in use, re-consent a few times a year instead of hourly.
//
// SECRET HANDLING: neither a raw token nor its hash is ever logged; store
// errors are logged by code only, since messages can echo row values.

import { createServiceClient } from '@/lib/supabase';

/** Sliding, per token: 30 days, matching SESSION_MAX_AGE_SECONDS in src/lib/session.ts. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Hard cap, per family, measured from its first token. Without it a family
 * that refreshes at least monthly — including one a thief is quietly riding —
 * would live forever. After this a human approves again.
 */
export const REFRESH_FAMILY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const TABLE = 'oauth_refresh_tokens';

/**
 * How long after a refresh token is rotated a second presentation of it by the
 * same client is still treated as a retry rather than theft. Long enough for a
 * retry after a lost response or two parallel refreshes; short enough that a
 * stolen token replayed later still burns the family.
 */
export const REFRESH_REUSE_GRACE_MS = 60 * 1000;

/** True when `usedAtIso` is a real timestamp no older than the grace window. */
export function isWithinReuseGrace(usedAtIso: string, nowMs: number): boolean {
  const usedAt = Date.parse(usedAtIso);
  if (!Number.isFinite(usedAt)) return false;
  const age = nowMs - usedAt;
  // A used_at in the future is not a retry we can reason about.
  return age >= 0 && age <= REFRESH_REUSE_GRACE_MS;
}

export interface RefreshGrant {
  family_id: string;
  client_id: string;
  subject: string;
  scope: string;
  resource: string | null;
  /** When the family's first token was issued; caps every successor's expiry. */
  family_started_at: string;
}

export interface MintRefreshInput {
  client_id: string;
  subject: string;
  scope: string;
  resource?: string | null;
  /** Omit to start a new family (fresh authorization_code grant). */
  family_id?: string;
  /** Pass with `family_id` when rotating, so the 90-day family cap holds. */
  family_started_at?: string;
}

export type RefreshFailure =
  | 'unknown'         // no such token
  | 'expired'         // token, or its whole family, has aged out
  | 'revoked'         // presented a revoked token — family burned
  | 'client_mismatch' // token belongs to a different client — NOT consumed
  | 'reused'          // rotated away, replayed after the grace — family burned
  | 'store_error';    // OUR failure, not the token's — retryable, burns nothing

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

/** Expiry for a token minted now in a family that started at `familyStartMs`. */
export function refreshExpiryMs(nowMs: number, familyStartMs: number): number {
  return Math.min(nowMs + REFRESH_TTL_MS, familyStartMs + REFRESH_FAMILY_MAX_AGE_MS);
}

/**
 * Mint a refresh token. Returns the plaintext — the ONLY time it exists
 * outside the client. Pass `family_id` (and `family_started_at`) to continue
 * an existing family (rotation); omit them to start a new one (fresh consent).
 */
export async function mintRefreshToken(
  input: MintRefreshInput,
): Promise<{ token: string; expires_at: string; family_id: string }> {
  const supabase = createServiceClient();
  const token = randomToken();
  const token_hash = await hashRefreshToken(token);
  const family_id = input.family_id ?? crypto.randomUUID();
  const now = Date.now();
  const startedMs = input.family_started_at ? Date.parse(input.family_started_at) : now;
  // An unparseable start can only shorten nothing: fall back to "started now".
  const expires_at = new Date(refreshExpiryMs(now, Number.isFinite(startedMs) ? startedMs : now)).toISOString();

  const { error } = await supabase.from(TABLE).insert({
    token_hash,
    family_id,
    client_id: input.client_id,
    subject: input.subject,
    scope: input.scope,
    resource: input.resource ?? null,
    expires_at,
  });
  if (error) {
    throw new Error(`oauth_refresh_tokens insert failed: ${error.code ?? 'no_code'}`);
  }
  return { token, expires_at, family_id };
}

/**
 * Revoke every token in a family. Called on reuse detection and whenever a
 * revoked token is presented. Returns the number of rows revoked, or -1 when
 * the store call failed (the family may still be live — callers log it).
 */
export async function revokeRefreshFamily(family_id: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('revoke_refresh_family', {
    p_family_id: family_id,
  });
  if (error) {
    console.error('[oauth] revokeRefreshFamily FAILED — family may still be live:', error.code ?? 'no_code');
    return -1;
  }
  return typeof data === 'number' ? data : 0;
}

/**
 * Revoke every refresh token held by a client. Used by the admin revoke
 * path so killing a client kills its ability to mint new access tokens,
 * not just the outstanding JWTs. Returns false when the store call failed.
 */
export async function revokeRefreshTokensForClient(client_id: string): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    // supabase-js reports failures in `error`; it does not throw.
    const { error } = await supabase
      .from(TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .is('revoked_at', null);
    if (error) {
      console.error('[oauth] revokeRefreshTokensForClient FAILED:', error.code ?? 'no_code');
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      '[oauth] revokeRefreshTokensForClient threw:',
      err instanceof Error ? err.name : 'unknown',
    );
    return false;
  }
}

/** When the family's first token was issued, or null if that cannot be read. */
async function familyStartedAt(family_id: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('created_at')
    .eq('family_id', family_id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const at = (data[0] as { created_at?: unknown }).created_at;
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null;
}

/**
 * Atomically claim a refresh token for rotation, on behalf of `client_id`.
 *
 * On success the caller mints ONE successor in the same family. Failures:
 *
 *   store_error      our database failed. Nothing is burned and the route
 *                    answers 5xx so the client keeps its token and retries.
 *                    Reporting these as invalid_grant would make the client
 *                    throw the token away and send a human back to log in.
 *   client_mismatch  wrong client. Consumes nothing, burns nothing: the match
 *                    is inside the atomic claim so a stolen token cannot be
 *                    used as a kill switch under someone else's client.
 *   revoked          a revoked token was presented. Burns the family (below).
 *   reused           a rotated token replayed after the grace. Burns the family.
 *
 * RETRY GRACE. A second presentation of an already-rotated token by the same
 * client within REFRESH_REUSE_GRACE_MS is a retry (response lost in transit,
 * or two refreshes at once) and is granted — burning the family for it sends
 * a human back to log in, which is the outage refresh tokens exist to remove.
 * It is granted WITHOUT forking the family: every other live token in the
 * family (i.e. the successor issued to the first presentation) is revoked
 * first, so a family never has more than one live token no matter how many
 * times the retry is replayed.
 *
 * That revocation is also what keeps theft detectable through the grace. If a
 * thief and the owner both present the same token inside the window, one of
 * them ends up holding a revoked successor; when they present it the family
 * is burned. So: presenting a REVOKED token burns the family too.
 */
export async function claimRefreshToken(
  token: string,
  client_id: string,
): Promise<RefreshResult> {
  const supabase = createServiceClient();
  const token_hash = await hashRefreshToken(token);

  const { data, error } = await supabase.rpc('claim_refresh_token', {
    p_token_hash: token_hash,
    p_client_id: client_id,
  });
  if (error) return { ok: false, reason: 'store_error' };

  const claimed = Array.isArray(data) ? data[0] : data;
  if (claimed) {
    const row = claimed as Record<string, unknown>;
    // Invariant: after a claim the family has NO live token until the caller
    // mints one. Normally this revokes nothing. It matters after a grace
    // collision that raced a mint and left two live successors: claiming one
    // revokes the other, and whoever holds that one burns the family when
    // they present it. If the write fails, fail retryable (the retry lands in
    // the grace window) rather than risk a second live chain.
    const { error: siblingErr } = await supabase
      .from(TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('family_id', row.family_id as string)
      .is('used_at', null)
      .is('revoked_at', null);
    if (siblingErr) return { ok: false, reason: 'store_error' };
    return finishGrant({
      family_id: row.family_id as string,
      client_id: row.client_id as string,
      subject: row.subject as string,
      scope: row.scope as string,
      resource: (row.resource as string | null) ?? null,
    });
  }

  // The claim did not land. Read the row back to find out why — this is the
  // difference between "your token aged out" and "someone is replaying a
  // token we already rotated away."
  const { data: row, error: readErr } = await supabase
    .from(TABLE)
    .select('family_id, client_id, subject, scope, resource, used_at, revoked_at, expires_at')
    .eq('token_hash', token_hash)
    .maybeSingle();

  if (readErr) return { ok: false, reason: 'store_error' };
  if (!row) return { ok: false, reason: 'unknown' };

  const r = row as {
    family_id: string;
    client_id: string;
    subject: string;
    scope: string;
    resource: string | null;
    used_at: string | null;
    revoked_at: string | null;
    expires_at: string;
  };

  // Wrong client. Report it without burning anything — see the note above.
  // Nothing was consumed, so the legitimate holder is unaffected.
  if (r.client_id !== client_id) return { ok: false, reason: 'client_mismatch' };

  // A revoked token in the right client's hands: the loser of a grace
  // collision, or a token from a family that was already burned. Either way
  // the family must not survive it.
  if (r.revoked_at) {
    await revokeRefreshFamily(r.family_id);
    return { ok: false, reason: 'revoked' };
  }
  if (Date.parse(r.expires_at) < Date.now()) return { ok: false, reason: 'expired' };

  if (r.used_at) {
    if (!isWithinReuseGrace(r.used_at, Date.now())) {
      // REUSE after the grace: assume compromise, burn the family.
      await revokeRefreshFamily(r.family_id);
      return { ok: false, reason: 'reused' };
    }
    // Retry inside the grace. Withdraw whatever was issued to the earlier
    // presentation so the family keeps exactly one live token. If that write
    // fails we must not mint a second live token: fail retryable instead.
    const { error: withdrawErr } = await supabase
      .from(TABLE)
      .update({ revoked_at: new Date().toISOString() })
      .eq('family_id', r.family_id)
      .is('used_at', null)
      .is('revoked_at', null);
    if (withdrawErr) return { ok: false, reason: 'store_error' };

    return finishGrant({
      family_id: r.family_id,
      client_id: r.client_id,
      subject: r.subject,
      scope: r.scope,
      resource: r.resource ?? null,
    });
  }

  // The claim returned nothing, yet the row reads live and unused: a racer's
  // write is not visible yet, or the claim misfired. Nothing was consumed and
  // there is no evidence of reuse, so burn nothing and let the client retry.
  return { ok: false, reason: 'store_error' };
}

/** Apply the hard family lifetime, then hand back the grant. */
async function finishGrant(grant: Omit<RefreshGrant, 'family_started_at'>): Promise<RefreshResult> {
  const started = await familyStartedAt(grant.family_id);
  // The presented token is already spent at this point. If the family start
  // cannot be read, fail retryable: the retry lands in the grace window.
  if (!started) return { ok: false, reason: 'store_error' };
  if (Date.parse(started) + REFRESH_FAMILY_MAX_AGE_MS <= Date.now()) {
    await revokeRefreshFamily(grant.family_id);
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, grant: { ...grant, family_started_at: started } };
}
