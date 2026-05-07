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
  };
}

/**
 * Atomically consume a transaction. Returns the row exactly once; subsequent
 * calls (replay) return null. Returns null on expired or unknown tx_id.
 *
 * Implementation note: uses the consume_consent_transaction RPC defined in
 * 20260506_oauth_consent_transactions.sql so the SELECT + UPDATE are one
 * atomic operation at the database level.
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
  };
}
