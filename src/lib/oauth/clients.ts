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
import { revokeRefreshTokensForClient } from '@/lib/oauth/refresh';

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
  /** Set by revokeClient(). When non-null, all token validation rejects this client. */
  revoked_at: string | null;
  /** Set by touchClientUsage() on each successful access-token validation. */
  last_used_at: string | null;
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

/**
 * Revoke a client. After this returns, all future access-token validations
 * for this client_id reject (verifyAccessToken returns null). Existing
 * tokens become inert without waiting for their 1h TTL to expire.
 *
 * Idempotent: revoking an already-revoked client succeeds and updates the
 * timestamp.
 *
 * Also revokes every refresh-token family the client holds, so a later
 * un-revoke does not silently resurrect old sessions — the client has to go
 * through consent again. That cascade is best-effort (it must not fail the
 * revoke while the refresh-token table is still un-migrated); the refresh
 * grant independently re-checks `revoked_at` and burns the family, so a
 * failed cascade cannot be used to refresh while the client stays revoked.
 */
export async function revokeClient(clientId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from('oauth_clients')
    .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
    .eq('client_id', clientId);
  if (error) {
    throw new Error(`oauth_clients revoke failed: ${error.message}`);
  }
  await revokeRefreshTokensForClient(clientId);
  return (count ?? 0) > 0;
}

/**
 * Un-revoke a client. Recovery path for accidental revocation. Sets
 * revoked_at = null. No-op if the client wasn't revoked.
 */
export async function unrevokeClient(clientId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from('oauth_clients')
    .update({ revoked_at: null }, { count: 'exact' })
    .eq('client_id', clientId);
  if (error) {
    throw new Error(`oauth_clients unrevoke failed: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

/**
 * Best-effort bump of last_used_at. Failures are swallowed — this is
 * observability, not a security gate, and we don't want to fail an MCP
 * request because Supabase had a hiccup.
 */
export async function touchClientUsage(clientId: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('oauth_clients')
      .update({ last_used_at: new Date().toISOString() })
      .eq('client_id', clientId);
  } catch (err) {
    console.warn('[oauth] touchClientUsage failed:', err instanceof Error ? err.message : String(err));
  }
}

export const CLIENT_LIST_DEFAULT_LIMIT = 200;
export const CLIENT_LIST_MAX_LIMIT = 500;

export interface ListClientsOptions {
  /** Page size. Clamped to 1..CLIENT_LIST_MAX_LIMIT. */
  limit?: number;
  /** Rows to skip. Clamped to >= 0. */
  offset?: number;
}

export interface ClientPage {
  clients: OAuthClient[];
  limit: number;
  offset: number;
  /** True when at least one more row exists past this page. */
  has_more: boolean;
}

/**
 * List clients for the admin UI — newest first, bounded.
 *
 * This used to be an unbounded `select *`. Production accumulated 342 rows
 * (≈340 of them nightly-e2e leftovers) and the admin response was 104 KB.
 * Now it is a page: `limit` rows starting at `offset`, ordered by
 * `created_at DESC`. One extra row is fetched to compute `has_more`.
 */
export async function listClientsPage(opts: ListClientsOptions = {}): Promise<ClientPage> {
  const limit = Math.min(
    CLIENT_LIST_MAX_LIMIT,
    Math.max(1, Math.floor(Number.isFinite(opts.limit) ? (opts.limit as number) : CLIENT_LIST_DEFAULT_LIMIT)),
  );
  const offset = Math.max(0, Math.floor(Number.isFinite(opts.offset) ? (opts.offset as number) : 0));
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('oauth_clients')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit); // inclusive → limit + 1 rows
  if (error) {
    throw new Error(`oauth_clients list failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as OAuthClient[];
  return {
    clients: rows.slice(0, limit),
    limit,
    offset,
    has_more: rows.length > limit,
  };
}

/**
 * Back-compat wrapper: the first page of clients (newest first, at most
 * CLIENT_LIST_DEFAULT_LIMIT unless a limit is given).
 */
export async function listClients(opts: ListClientsOptions = {}): Promise<OAuthClient[]> {
  return (await listClientsPage(opts)).clients;
}

// ─── Registration flood cap + stale-client pruning ──────────────────────────

/**
 * Ceiling on live (non-revoked) clients created in any rolling 24h window
 * before ANONYMOUS registration is refused. One human wiring up Claude.app
 * creates one or two rows; the nightly e2e creates about six. Fifty leaves
 * an order of magnitude of headroom and still bounds what an open-DCR flood
 * can write to the table at 50 rows/day.
 */
export const MAX_NEW_CLIENTS_PER_24H = 50;

export const CLIENT_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Upper bound on rows deleted by a single prune pass. Kept at 100 so the
 * `id=in.(...)` delete filter stays a few KB of URL; a larger backlog drains
 * over successive passes.
 */
export const CLIENT_PRUNE_BATCH = 100;
const E2E_NAME_PREFIX = 'e2e-';

/**
 * Count non-revoked clients created in the last 24h. Throws on a store error
 * so the caller can fail closed.
 */
export async function countRecentClients(nowMs: number = Date.now()): Promise<number> {
  const supabase = createServiceClient();
  const since = new Date(nowMs - CLIENT_PRUNE_AGE_MS).toISOString();
  const { count, error } = await supabase
    .from('oauth_clients')
    .select('id', { count: 'exact', head: true })
    .is('revoked_at', null)
    // Anonymous registrations only (the route stamps every row it creates).
    // Counting session-created rows too would let a busy e2e day — every
    // post-deploy smoke registers several test clients — use up the cap and
    // lock Claude's connector out of registering.
    .eq('metadata->>registered_via', 'open-dcr')
    .gte('created_at', since);
  if (error) {
    throw new Error(`oauth_clients recent count failed: ${error.message}`);
  }
  return count ?? 0;
}

type PrunableFields = Pick<OAuthClient, 'client_name' | 'created_at' | 'revoked_at' | 'metadata'>;

/**
 * A pre-registered client is one an operator inserted by hand (e.g. the
 * "Claude.app (pre-registered)" row) rather than one that arrived through
 * /api/oauth/register. They are never pruned, even when revoked.
 *
 * Not spoofable through registration: the route stamps every row it creates
 * with `metadata.registered_via` (and whitelists the metadata keys a caller
 * can set), so a dynamically registered client that merely NAMES itself
 * "… (pre-registered)" does not qualify and gets pruned like any other.
 */
export function isPreRegisteredClient(c: Pick<OAuthClient, 'client_name' | 'metadata'>): boolean {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  if (meta.registered_via !== undefined) return false;
  if (meta.pre_registered === true || meta.preregistered === true) return true;
  return typeof c.client_name === 'string' && /pre-?registered/i.test(c.client_name);
}

/**
 * THE prune rule, as a pure function. A client may be deleted only if:
 *   (a) it was revoked more than 24h ago, OR
 *   (b) its name starts with `e2e-` AND it was created more than 24h ago.
 * and it is not a pre-registered client. Anything unparseable is kept.
 */
export function isPrunableClient(c: PrunableFields, nowMs: number = Date.now()): boolean {
  if (isPreRegisteredClient(c)) return false;
  const cutoff = nowMs - CLIENT_PRUNE_AGE_MS;

  if (c.revoked_at) {
    const revokedAt = Date.parse(c.revoked_at);
    if (Number.isFinite(revokedAt) && revokedAt < cutoff) return true;
  }

  if (typeof c.client_name === 'string' && c.client_name.startsWith(E2E_NAME_PREFIX)) {
    const createdAt = Date.parse(c.created_at);
    if (Number.isFinite(createdAt) && createdAt < cutoff) return true;
  }

  return false;
}

export interface PruneResult {
  examined: number;
  deleted: number;
}

/**
 * Delete stale clients. Conservative by construction: the database filters
 * only NARROW the candidate set; every candidate is then re-judged by
 * isPrunableClient() and only rows it approves are deleted, by primary key.
 * Refresh tokens of deleted clients are removed too (best-effort).
 *
 * Throws on a store error; the registration route calls this best-effort and
 * swallows the throw.
 */
export async function pruneStaleClients(nowMs: number = Date.now()): Promise<PruneResult> {
  const supabase = createServiceClient();
  const cutoffIso = new Date(nowMs - CLIENT_PRUNE_AGE_MS).toISOString();

  const revoked = await supabase
    .from('oauth_clients')
    .select('id, client_id, client_name, created_at, revoked_at, metadata')
    .lt('revoked_at', cutoffIso)
    .limit(CLIENT_PRUNE_BATCH);
  if (revoked.error) {
    throw new Error(`oauth_clients prune (revoked scan) failed: ${revoked.error.message}`);
  }

  const e2e = await supabase
    .from('oauth_clients')
    .select('id, client_id, client_name, created_at, revoked_at, metadata')
    .like('client_name', `${E2E_NAME_PREFIX}%`)
    .lt('created_at', cutoffIso)
    .limit(CLIENT_PRUNE_BATCH);
  if (e2e.error) {
    throw new Error(`oauth_clients prune (e2e scan) failed: ${e2e.error.message}`);
  }

  type Candidate = PrunableFields & { id: string; client_id: string };
  const byId = new Map<string, Candidate>();
  for (const row of [...(revoked.data ?? []), ...(e2e.data ?? [])] as unknown as Candidate[]) {
    byId.set(row.id, row);
  }
  const doomed = Array.from(byId.values())
    .filter(c => isPrunableClient(c, nowMs))
    .slice(0, CLIENT_PRUNE_BATCH);
  if (doomed.length === 0) return { examined: byId.size, deleted: 0 };

  const { error: delErr, count } = await supabase
    .from('oauth_clients')
    .delete({ count: 'exact' })
    .in('id', doomed.map(c => c.id));
  if (delErr) {
    throw new Error(`oauth_clients prune delete failed: ${delErr.message}`);
  }

  // Their refresh tokens are dead weight now (and already unusable: the
  // refresh grant rejects a token whose client row is gone). Best-effort —
  // the table may not be migrated yet.
  const { error: rtErr } = await supabase
    .from('oauth_refresh_tokens')
    .delete()
    .in('client_id', doomed.map(c => c.client_id));
  if (rtErr) {
    console.warn('[oauth] prune: refresh-token cleanup skipped:', rtErr.message);
  }

  return { examined: byId.size, deleted: count ?? doomed.length };
}
