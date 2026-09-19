import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory stand-in for the oauth_refresh_tokens table + its two RPCs.
//
// These tests pin the security-relevant behaviour of the rotating refresh
// family added 2026-09-19: rotation actually rotates, reuse burns the whole
// family, and expired/revoked tokens never claim.
// ---------------------------------------------------------------------------

interface Row {
  token_hash: string;
  family_id: string;
  client_id: string;
  subject: string;
  scope: string;
  resource: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

let rows: Row[] = [];

function claimRpc(token_hash: string) {
  const now = Date.now();
  const row = rows.find(
    (r) =>
      r.token_hash === token_hash &&
      r.used_at === null &&
      r.revoked_at === null &&
      Date.parse(r.expires_at) > now,
  );
  if (!row) return { data: [], error: null };
  row.used_at = new Date().toISOString();
  return {
    data: [
      {
        family_id: row.family_id,
        client_id: row.client_id,
        subject: row.subject,
        scope: row.scope,
        resource: row.resource,
      },
    ],
    error: null,
  };
}

function revokeFamilyRpc(family_id: string) {
  let n = 0;
  for (const r of rows) {
    if (r.family_id === family_id && r.revoked_at === null) {
      r.revoked_at = new Date().toISOString();
      n++;
    }
  }
  return { data: n, error: null };
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'oauth_refresh_tokens') throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: Omit<Row, 'used_at' | 'revoked_at'>) => {
          rows.push({ ...row, used_at: null, revoked_at: null });
          return Promise.resolve({ error: null });
        },
        select: (_cols: string) => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: () => {
              const found = rows.find((r) => r.token_hash === val);
              return Promise.resolve({ data: found ?? null, error: null });
            },
          }),
        }),
        update: (patch: Partial<Row>) => ({
          eq: (_col: string, val: string) => ({
            is: (_c: string, _v: null) => {
              for (const r of rows) {
                if (r.client_id === val && r.revoked_at === null) {
                  Object.assign(r, patch);
                }
              }
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
    rpc: (name: string, args: Record<string, string>) => {
      if (name === 'claim_refresh_token') return Promise.resolve(claimRpc(args.p_token_hash));
      if (name === 'revoke_refresh_family') return Promise.resolve(revokeFamilyRpc(args.p_family_id));
      throw new Error(`unexpected rpc ${name}`);
    },
  }),
}));

import {
  mintRefreshToken,
  claimRefreshToken,
  revokeRefreshFamily,
  revokeRefreshTokensForClient,
  hashRefreshToken,
} from '../oauth/refresh';

const GRANT = {
  client_id: 'gt_claude_app_test',
  subject: 'wes',
  scope: 'mcp',
  resource: 'https://terminal.johnwesleyhicks.com/api/mcp',
};

describe('OAuth refresh tokens — rotation and reuse detection', () => {
  beforeEach(() => {
    rows = [];
  });

  it('never stores the plaintext token', async () => {
    const { token } = await mintRefreshToken(GRANT);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toBe(await hashRefreshToken(token));
    // Nothing in the row should contain the plaintext anywhere.
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('claims a live token once and carries the grant context through', async () => {
    const { token, family_id } = await mintRefreshToken(GRANT);
    const result = await claimRefreshToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.family_id).toBe(family_id);
    expect(result.grant.client_id).toBe(GRANT.client_id);
    expect(result.grant.subject).toBe('wes');
    expect(result.grant.resource).toBe(GRANT.resource);
  });

  it('rotation keeps the successor in the same family', async () => {
    const first = await mintRefreshToken(GRANT);
    const claimed = await claimRefreshToken(first.token);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const second = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });
    expect(second.family_id).toBe(first.family_id);
    expect(second.token).not.toBe(first.token);

    // The successor is independently claimable.
    const again = await claimRefreshToken(second.token);
    expect(again.ok).toBe(true);
  });

  it('REUSE of an already-rotated token burns the entire family', async () => {
    const first = await mintRefreshToken(GRANT);
    const claimed = await claimRefreshToken(first.token);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const second = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });
    const third = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });

    // Replay the spent first token — the classic stolen-token signal.
    const replay = await claimRefreshToken(first.token);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe('reused');

    // Every sibling must now be dead, including ones never presented.
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    expect((await claimRefreshToken(second.token)).ok).toBe(false);
    expect((await claimRefreshToken(third.token)).ok).toBe(false);
  });

  it('rejects an unknown token without touching anything', async () => {
    await mintRefreshToken(GRANT);
    const result = await claimRefreshToken('deadbeef'.repeat(8));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown');
    expect(rows[0].used_at).toBeNull();
  });

  it('rejects an expired token as expired, not reused', async () => {
    const { token } = await mintRefreshToken(GRANT);
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await claimRefreshToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('rejects a revoked token as revoked', async () => {
    const { token, family_id } = await mintRefreshToken(GRANT);
    await revokeRefreshFamily(family_id);
    const result = await claimRefreshToken(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('revoked');
  });

  it('revoking a client kills its outstanding refresh tokens', async () => {
    const mine = await mintRefreshToken(GRANT);
    const other = await mintRefreshToken({ ...GRANT, client_id: 'gt_someone_else' });

    await revokeRefreshTokensForClient(GRANT.client_id);

    expect((await claimRefreshToken(mine.token)).ok).toBe(false);
    // An unrelated client is untouched.
    expect((await claimRefreshToken(other.token)).ok).toBe(true);
  });

  it('two concurrent claims of the same token: exactly one wins', async () => {
    const { token } = await mintRefreshToken(GRANT);
    const [a, b] = await Promise.all([
      claimRefreshToken(token),
      claimRefreshToken(token),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});
