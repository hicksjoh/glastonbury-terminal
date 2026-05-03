// OAuth authorization codes — short-lived, single-use, PKCE-bound.
//
// /api/oauth/finalize mints a code after Wes consents on the consent page.
// /api/oauth/token consumes it. The row records the PKCE challenge so we
// can verify the verifier at exchange time, and the redirect_uri so we can
// reject token requests that present a different redirect_uri than the
// authorize step did (RFC 6749 §10.6).

import { createServiceClient } from '@/lib/supabase';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes per OAuth best practice

export interface OAuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scope: string;
  subject: string;
  state: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface MintCodeInput {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  /** Always 'S256'. We reject 'plain' upstream. */
  code_challenge_method: 'S256';
  scope: string;
  subject: string;
  state?: string | null;
}

function randomCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Hex encode — RFC 6749 says any opaque value is fine.
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export async function mintCode(input: MintCodeInput): Promise<string> {
  const supabase = createServiceClient();
  const code = randomCode();
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await supabase.from('oauth_codes').insert({
    code,
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    scope: input.scope,
    subject: input.subject,
    state: input.state ?? null,
    expires_at: expires,
  });
  if (error) throw new Error(`oauth_codes insert failed: ${error.message}`);
  return code;
}

/**
 * Atomically consume a code. Returns the row if it was active and unused;
 * marks it used in the same transaction. Returns null in every failure
 * mode (not found / expired / already used) — callers should always
 * respond with the same generic error so an attacker can't tell which.
 *
 * RFC 6749 §10.5: if the code has already been used, every existing token
 * issued from the original auth session SHOULD be revoked. We don't do
 * that here yet because v1 has no token revocation; flagged in code as
 * a future-improvement note.
 */
export async function consumeCode(code: string): Promise<OAuthCode | null> {
  const supabase = createServiceClient();

  // First read — must be unused and unexpired.
  const { data: row, error } = await supabase
    .from('oauth_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error || !row) return null;

  const r = row as unknown as OAuthCode;
  if (r.used_at) return null;
  if (Date.parse(r.expires_at) < Date.now()) return null;

  // Mark used. The where-clause guards against a concurrent consumer.
  const { error: updateErr, count } = await supabase
    .from('oauth_codes')
    .update({ used_at: new Date().toISOString() }, { count: 'exact' })
    .eq('code', code)
    .is('used_at', null);
  if (updateErr || !count || count < 1) return null;

  return r;
}
