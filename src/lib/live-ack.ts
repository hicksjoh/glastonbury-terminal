/**
 * Live-trading acknowledgment tokens.
 *
 * Live-mode order submission requires proof that the user (Wes)
 * consciously acknowledged the "REAL MONEY" mode within the current
 * session. This is server-enforced: an ack token that isn't present,
 * expired, or forged in the DB causes the order route to reject.
 *
 * Storage: `live_trading_acks` in Supabase. See migration
 * supabase/migrations/20260803_live_trading_acks.sql.
 *
 * Token issuance flow:
 *   1. Client-side <LiveTradingGate> mounts on Trading / Keisha pages
 *   2. User is shown a red modal, types "CONFIRM LIVE" verbatim
 *   3. Client POSTs /api/trading/live-ack → we insert a row w/ ttl
 *   4. Server returns an opaque token; client stores in sessionStorage
 *   5. Every subsequent order POST includes the token
 *   6. Order route calls verifyLiveAckToken() before submitting
 *
 * The token is NOT a JWT — it's a random 32-byte hex string looked up
 * in the DB. Simpler than JWT rotation, and revocable (DELETE from the
 * table forces re-ack on the next order).
 */

import { randomBytes } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase';
import { LiveOrderRejectedError } from '@/lib/trading-mode';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1_000; // 4 hours

function ttlMs(): number {
  const raw = Number(process.env.LIVE_ACK_SESSION_TTL_MS);
  return Number.isFinite(raw) && raw > 5 * 60_000 ? raw : DEFAULT_TTL_MS;
}

/**
 * The literal phrase the user must type to mint an ack. Any typo /
 * whitespace mismatch is rejected. Case-insensitive by design (mobile
 * autocorrect will lowercase-first-char) but no partial matches.
 */
export const LIVE_ACK_PHRASE = 'CONFIRM LIVE';

export function isValidLiveAckPhrase(input: string | undefined): boolean {
  return (input ?? '').trim().toUpperCase() === LIVE_ACK_PHRASE;
}

interface AckRow {
  token: string;
  user_hint: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Mint a new live-trading ack token. Client must POST the exact phrase
 * "CONFIRM LIVE" (case-insensitive). Returns the opaque token +
 * expiration. Caller (route) is responsible for setting SameSite=Strict
 * cookie or returning to sessionStorage; server stays stateless w.r.t.
 * where the client stores the token.
 */
export async function mintLiveAckToken(args: {
  phrase: string;
  userHint: string;   // free-form label — e.g., "wes@localhost" for audit
}): Promise<{ token: string; expiresAt: string }> {
  if (!isValidLiveAckPhrase(args.phrase)) {
    throw new LiveOrderRejectedError(
      'live_ack_invalid',
      `Live-mode ack requires typing "${LIVE_ACK_PHRASE}" verbatim.`,
    );
  }
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs());

  const sb = createServiceClient();
  const { error } = await sb.from('live_trading_acks').insert({
    token,
    user_hint: args.userHint.slice(0, 200),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    throw new Error(`Failed to persist live-ack token: ${error.message}`);
  }
  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Verify a client-supplied ack token. Throws LiveOrderRejectedError on
 * missing / expired / revoked / unknown token. Returns the row on
 * success (caller may audit user_hint).
 *
 * Design decision: we do NOT delete the token on verify — the ack lasts
 * for its full TTL and can back many orders. Wes doesn't want to
 * re-type on every order submission; just once per session.
 */
export async function verifyLiveAckToken(token: string | undefined): Promise<AckRow> {
  if (!token || token.length !== 64) {
    throw new LiveOrderRejectedError(
      'live_ack_required',
      'Live-mode orders require a live-ack token — mint one via POST /api/trading/live-ack.',
    );
  }
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('live_trading_acks')
    .select('token, user_hint, created_at, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (error) {
    throw new Error(`live-ack lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new LiveOrderRejectedError('live_ack_invalid', 'Live-ack token not found — mint a fresh one.');
  }
  const row = data as unknown as AckRow;
  if (row.revoked_at) {
    throw new LiveOrderRejectedError('live_ack_invalid', 'Live-ack token was revoked.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new LiveOrderRejectedError('live_ack_expired', 'Live-ack token expired — re-confirm live mode.');
  }
  return row;
}

/**
 * Revoke an ack token — used on explicit sign-out or "exit live mode"
 * button. Silently succeeds if the token doesn't exist (no info leak).
 */
export async function revokeLiveAckToken(token: string | undefined): Promise<void> {
  if (!token) return;
  const sb = createServiceClient();
  await sb.from('live_trading_acks').update({ revoked_at: new Date().toISOString() }).eq('token', token);
}
