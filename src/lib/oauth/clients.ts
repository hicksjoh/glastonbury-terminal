// OAuth client registry.
//
// One row per registered client (e.g., one row per "Glastonbury Terminal"
// custom connector in Claude.app). The /api/oauth/register route writes
// rows here; the /authorize and /token routes read them.
//
// Public clients (PKCE only) carry a null client_secret_hash and
// token_endpoint_auth_method='none'. Confidential clients store a
// SHA-256 hash of the secret — never the plaintext.

import { createServiceClient } from '@/lib/supabase';

export interface OAuthClient {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_post';
  scope: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ClientRegistration {
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: 'none' | 'client_secret_post';
  scope?: string;
  metadata?: Record<string, unknown>;
}

export interface ClientCredentials {
  client_id: string;
  /** Plaintext secret returned ONCE at registration. Never re-fetchable. */
  client_secret?: string;
}

/**
 * Generate a URL-safe random string. Edge-compatible (uses crypto.getRandomValues).
 */
function randomString(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(digest);
  let s = '';
  for (let i = 0; i < arr.length; i++) {
    s += arr[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Validate redirect URIs at registration time. We accept HTTPS URIs and
 * the standard localhost-loopback shapes used by native MCP clients.
 *
 * Rejected: HTTP non-loopback (would leak codes in transit), wildcards,
 * fragments. RFC 7591 §2 requires absolute URIs.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hash) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') {
    // Allow loopback for native clients per RFC 8252 §7.3
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  }
  return false;
}

/**
 * Register a new client. Generates a client_id (and client_secret if
 * confidential), persists the row, returns the credentials. Plaintext
 * secret is only returned in this response.
 */
export async function registerClient(
  reg: ClientRegistration,
): Promise<ClientCredentials & { client_name: string; redirect_uris: string[]; scope: string; token_endpoint_auth_method: 'none' | 'client_secret_post' }> {
  const supabase = createServiceClient();

  const authMethod = reg.token_endpoint_auth_method ?? 'none';
  const scope = reg.scope ?? 'mcp';

  const client_id = `gt_${randomString(16)}`; // 32 hex chars = 128 bits
  let client_secret: string | undefined;
  let client_secret_hash: string | null = null;
  if (authMethod === 'client_secret_post') {
    client_secret = randomString(32); // 64 hex chars = 256 bits
    client_secret_hash = await sha256Hex(client_secret);
  }

  const { error } = await supabase.from('oauth_clients').insert({
    client_id,
    client_secret_hash,
    client_name: reg.client_name,
    redirect_uris: reg.redirect_uris,
    token_endpoint_auth_method: authMethod,
    scope,
    metadata: reg.metadata ?? {},
  });
  if (error) {
    throw new Error(`oauth_clients insert failed: ${error.message}`);
  }

  return {
    client_id,
    client_secret,
    client_name: reg.client_name,
    redirect_uris: reg.redirect_uris,
    scope,
    token_endpoint_auth_method: authMethod,
  };
}

/**
 * Look up a client by client_id. Returns null if not found.
 */
export async function findClient(clientId: string): Promise<OAuthClient | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as OAuthClient) ?? null;
}

/**
 * Verify a presented client_secret against the stored hash. Constant-time
 * compare. Returns false if the client is public (no secret) or if hashing
 * fails.
 */
export async function verifyClientSecret(
  client: OAuthClient,
  presentedSecret: string,
): Promise<boolean> {
  if (!client.client_secret_hash) return false;
  if (client.token_endpoint_auth_method !== 'client_secret_post') return false;
  const presentedHash = await sha256Hex(presentedSecret);
  if (presentedHash.length !== client.client_secret_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < presentedHash.length; i++) {
    diff |= presentedHash.charCodeAt(i) ^ client.client_secret_hash.charCodeAt(i);
  }
  return diff === 0;
}
