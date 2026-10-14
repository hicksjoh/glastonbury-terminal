// OAuth consent transactions — server-side binding between authorize and finalize.
//
// p3-2 (Codex finding #7). Pre-p3-2 the consent page round-tripped every
// authorize parameter through hidden form fields. /api/oauth/finalize
// trusted those fields after a re-validation pass. A CSRF gadget that
// tricked Wes into POSTing a constructed form could mint a code for any
// (client_id, redirect_uri) tuple — defeating the whole consent flow.
//
// Now: at authorize time we mint a tx_id (random 32 bytes hex), stash the
// params server-side, and pass ONLY the tx_id through the consent UI.
// Finalize atomically consumes the row and uses server-side params; the
// form's job is just to identify which transaction the human approved.

import { createServiceClient } from '@/lib/supabase';

const TX_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to read consent

export interface ConsentTransaction {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scope: string;
  subject: string;
  state: string | null;
  /**
   * P0-2: RFC 8707 resource indicator. The full URL of the protected
   * resource the access token will be bound to (typically
   * `${issuer}/api/mcp`). Null on legacy rows that pre-date the
   * 20260514 migration — those mint tokens with the legacy
   * placeholder audience.
   */
  resource: string | null;
}

function randomTxId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Mint a consent transaction. Called by /api/oauth/authorize after it has
 * validated all parameters. The returned tx_id is the only thing exposed
 * to the consent UI.
 */
export async function mintConsentTransaction(
  params: ConsentTransaction,
): Promise<string> {
  const supabase = createServiceClient();
  const tx_id = randomTxId();
  const expires_at = new Date(Date.now() + TX_TTL_MS).toISOString();
  const { error } = await supabase.from('oauth_consent_transactions').insert({
    tx_id,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: params.scope,
    subject: params.subject,
    state: params.state ?? null,
    resource: params.resource ?? null,
    expires_at,
  });
  if (error) {
    throw new Error(`oauth_consent_transactions insert failed: ${error.message}`);
  }
  return tx_id;
}

/**
 * Look up a transaction WITHOUT consuming it. Used by the consent page to
 * render the client info to the user. Does NOT mark used.
 *
 * Returns null if not found, expired, or already used.
 */
export async function peekConsentTransaction(
  tx_id: string,
): Promise<ConsentTransaction | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('oauth_consent_transactions')
    .select('*')
    .eq('tx_id', tx_id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    client_id: row.client_id as string,
    redirect_uri: row.redirect_uri as string,
    code_challenge: row.code_challenge as string,
    code_challenge_method: row.code_challenge_method as 'S256',
    scope: row.scope as string,
    subject: row.subject as string,
    state: (row.state as string | null) ?? null,
    resource: (row.resource as string | null) ?? null,
  };
}

/**
 * Atomically consume a transaction. Returns the row exactly once; subsequent
 * calls (replay) return null. Returns null on expired or unknown tx_id.
 *
 * Implementation note: uses the consume_consent_transaction RPC defined in
 * 20260506_oauth_consent_transactions.sql so the SELECT + UPDATE are one
 * atomic operation at the database level. Migration 20260514 adds the
 * `resource` column to the return signature.
 */
export async function consumeConsentTransaction(
  tx_id: string,
): Promise<ConsentTransaction | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('consume_consent_transaction', {
    p_tx_id: tx_id,
  });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    client_id: row.client_id as string,
    redirect_uri: row.redirect_uri as string,
    code_challenge: row.code_challenge as string,
    code_challenge_method: row.code_challenge_method as 'S256',
    scope: row.scope as string,
    subject: row.subject as string,
    state: (row.state as string | null) ?? null,
    resource: (row.resource as string | null) ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Duplicate-submit recovery (2026-09-19 connector QA).
//
// consume is single-use by design, and that stays. What was wrong is what
// happened NEXT: a second POST of the same tx got NULL and the route
// answered with a dead-end 400. In production that 400 replaced the
// in-flight navigation to claude.ai and stranded a valid, never-exchanged
// authorization code — read by the user as "authentication expired" moments
// after logging in.
//
// So: remember the code each transaction minted, and let a duplicate submit
// re-issue the SAME redirect. That is not a second grant. The code is still
// consumed exactly once at /api/oauth/token; we are only re-delivering a
// result the user already approved, to a redirect_uri the authorize step
// already validated against the client registry.
// ───────────────────────────────────────────────────────────────────────────

/** How long after consumption a duplicate submit can still be replayed. */
const REPLAY_GRACE_MS = 5 * 60 * 1000;

export interface ReplayableConsent {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  subject: string;
  issued_code: string;
}

/**
 * Record the authorization code a transaction minted, so a duplicate submit
 * can be answered with the same redirect instead of an error.
 *
 * Best-effort: a failure here costs us the replay path on that one
 * transaction, which is exactly the pre-fix behaviour. It must never fail
 * the request that already minted a good code.
 */
export async function recordIssuedCode(
  tx_id: string,
  code: string,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('oauth_consent_transactions')
      .update({ issued_code: code })
      .eq('tx_id', tx_id);
  } catch (err) {
    console.warn(
      '[oauth] recordIssuedCode failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Look up an already-consumed transaction that is still inside the replay
 * grace window and has a recorded code. Returns null when the tx is unknown,
 * was never consumed, is outside the window, or never got a code recorded.
 *
 * Callers MUST still re-validate the client and redirect_uri and confirm the
 * replaying session is the same subject that approved — this function proves
 * only that a code was issued for this tx, not that the caller may have it.
 */
export async function findReplayableConsent(
  tx_id: string,
): Promise<ReplayableConsent | null> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - REPLAY_GRACE_MS).toISOString();
  const { data, error } = await supabase
    .from('oauth_consent_transactions')
    .select('client_id, redirect_uri, state, subject, issued_code, used_at')
    .eq('tx_id', tx_id)
    .not('issued_code', 'is', null)
    .gt('used_at', since)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const issued_code = row.issued_code as string | null;
  if (!issued_code) return null;
  return {
    client_id: row.client_id as string,
    redirect_uri: row.redirect_uri as string,
    state: (row.state as string | null) ?? null,
    subject: row.subject as string,
    issued_code,
  };
}

/**
 * findReplayableConsent with a short bounded retry.
 *
 * The two submits race. A double-click fires them ~150-300ms apart, which
 * can be less than the time the winner needs to mint its code and write it
 * back — so a single lookup would miss a transaction that is about to
 * become replayable and we'd show the dead-end error we are trying to kill.
 *
 * Retry for a beat. The wait is bounded and only ever happens on a request
 * that was already going to fail, so it costs nothing on the happy path.
 */
export async function findReplayableConsentWithRetry(
  tx_id: string,
  attempts = 4,
  delayMs = 250,
): Promise<ReplayableConsent | null> {
  for (let i = 0; i < attempts; i++) {
    const found = await findReplayableConsent(tx_id);
    if (found) return found;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

