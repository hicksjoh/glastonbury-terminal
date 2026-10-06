import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory stand-in for the oauth_refresh_tokens table + its two RPCs.
//
// These tests pin the security-relevant behaviour of the rotating refresh
// family added 2026-09-19: rotation actually rotates, reuse burns the whole
// family, and expired/revoked tokens never claim.
// ---------------------------------------------------------------------------

// The columns that exist on oauth_refresh_tokens IN PRODUCTION
// (20260919_oauth_finalize_idempotency_and_refresh.sql). The fake rejects any
// other column name in a filter, select, insert or update, so code that
// reaches for a column the real table does not have fails here instead of at
// runtime behind a swallowed error.
const COLUMNS = [
  'token_hash', 'family_id', 'client_id', 'subject', 'scope', 'resource',
  'created_at', 'expires_at', 'used_at', 'revoked_at',
] as const;
type Col = (typeof COLUMNS)[number];

interface Row {
  token_hash: string;
  family_id: string;
  client_id: string;
  subject: string;
  scope: string;
  resource: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

let rows: Row[] = [];
/** Make the next matching store call fail: (op, detail) => error or undefined. */
let failNext: ((op: string, detail: string) => { code: string; message: string } | undefined) | null = null;
let clock = 0;

function col(name: string): Col {
  if (!(COLUMNS as readonly string[]).includes(name)) {
    throw new Error(`oauth_refresh_tokens has no column "${name}" in production`);
  }
  return name as Col;
}
function injected(op: string, detail: string) {
  return failNext ? failNext(op, detail) : undefined;
}

function claimRpc(token_hash: string, client_id: string) {
  const now = Date.now();
  const row = rows.find(
    (r) =>
      r.token_hash === token_hash &&
      r.client_id === client_id &&
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

/** Minimal PostgREST-style builder: filters accumulate, then it is awaited. */
class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private orderCol: Col | null = null;
  private asc = true;
  private max: number | null = null;
  constructor(private op: 'select' | 'update', private patch: Partial<Row> | null) {}
  eq(c: string, v: unknown) { const k = col(c); this.filters.push((r) => r[k] === v); return this; }
  is(c: string, v: null) { const k = col(c); this.filters.push((r) => r[k] === v); return this; }
  order(c: string, o: { ascending: boolean }) { this.orderCol = col(c); this.asc = o.ascending; return this; }
  limit(n: number) { this.max = n; return this; }
  private run(): { data: Row[] | null; error: { code: string; message: string } | null } {
    const err = injected(this.op, JSON.stringify(this.patch ?? {}));
    if (err) return { data: null, error: err };
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      for (const r of hit) Object.assign(r, this.patch);
      return { data: null, error: null };
    }
    if (this.orderCol) {
      const k = this.orderCol;
      hit = [...hit].sort((x, y) => String(x[k]).localeCompare(String(y[k])) * (this.asc ? 1 : -1));
    }
    if (this.max !== null) hit = hit.slice(0, this.max);
    return { data: hit, error: null };
  }
  maybeSingle() {
    const res = this.run();
    return Promise.resolve({ data: res.data ? res.data[0] ?? null : null, error: res.error });
  }
  then<T>(resolve: (v: { data: Row[] | null; error: { code: string; message: string } | null }) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'oauth_refresh_tokens') throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: Record<string, unknown>) => {
          for (const k of Object.keys(row)) col(k);
          const err = injected('insert', '');
          if (err) return Promise.resolve({ error: err });
          // created_at is the database default; strictly increasing here so
          // "first token of the family" is well defined.
          const created_at = new Date(Date.now() + clock++).toISOString();
          rows.push({ created_at, used_at: null, revoked_at: null, ...(row as object) } as Row);
          return Promise.resolve({ error: null });
        },
        select: (cols: string) => {
          for (const c of cols.split(',')) col(c.trim());
          return new Query('select', null);
        },
        update: (patch: Partial<Row>) => {
          for (const k of Object.keys(patch)) col(k);
          return new Query('update', patch);
        },
      };
    },
    rpc: (name: string, args: Record<string, string>) => {
      const err = injected('rpc', name);
      if (err) return Promise.resolve({ data: null, error: err });
      if (name === 'claim_refresh_token') {
        return Promise.resolve(claimRpc(args.p_token_hash, args.p_client_id));
      }
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
  isWithinReuseGrace,
  refreshExpiryMs,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TTL_MS,
  REFRESH_FAMILY_MAX_AGE_MS,
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
    failNext = null;
    clock = 0;
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
    const result = await claimRefreshToken(token, GRANT.client_id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.family_id).toBe(family_id);
    expect(result.grant.client_id).toBe(GRANT.client_id);
    expect(result.grant.subject).toBe('wes');
    expect(result.grant.resource).toBe(GRANT.resource);
  });

  it('rotation keeps the successor in the same family', async () => {
    const first = await mintRefreshToken(GRANT);
    const claimed = await claimRefreshToken(first.token, GRANT.client_id);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const second = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });
    expect(second.family_id).toBe(first.family_id);
    expect(second.token).not.toBe(first.token);

    // The successor is independently claimable.
    const again = await claimRefreshToken(second.token, GRANT.client_id);
    expect(again.ok).toBe(true);
  });

  it('REUSE of an already-rotated token, after the retry grace, burns the entire family', async () => {
    const first = await mintRefreshToken(GRANT);
    const claimed = await claimRefreshToken(first.token, GRANT.client_id);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const second = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });
    const third = await mintRefreshToken({ ...GRANT, family_id: claimed.grant.family_id });

    // Replay the spent first token after the retry grace — the classic
    // stolen-token signal.
    for (const r of rows) {
      if (r.used_at) r.used_at = new Date(Date.now() - 2 * REFRESH_REUSE_GRACE_MS).toISOString();
    }
    const replay = await claimRefreshToken(first.token, GRANT.client_id);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe('reused');

    // Every sibling must now be dead, including ones never presented.
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    expect((await claimRefreshToken(second.token, GRANT.client_id)).ok).toBe(false);
    expect((await claimRefreshToken(third.token, GRANT.client_id)).ok).toBe(false);
  });

  it('rejects an unknown token without touching anything', async () => {
    await mintRefreshToken(GRANT);
    const result = await claimRefreshToken('deadbeef'.repeat(8), GRANT.client_id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown');
    expect(rows[0].used_at).toBeNull();
  });

  it('rejects an expired token as expired, not reused', async () => {
    const { token } = await mintRefreshToken(GRANT);
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await claimRefreshToken(token, GRANT.client_id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('rejects a revoked token as revoked', async () => {
    const { token, family_id } = await mintRefreshToken(GRANT);
    await revokeRefreshFamily(family_id);
    const result = await claimRefreshToken(token, GRANT.client_id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('revoked');
  });

  it('revoking a client kills its outstanding refresh tokens', async () => {
    const mine = await mintRefreshToken(GRANT);
    const other = await mintRefreshToken({ ...GRANT, client_id: 'gt_someone_else' });

    await revokeRefreshTokensForClient(GRANT.client_id);

    expect((await claimRefreshToken(mine.token, GRANT.client_id)).ok).toBe(false);
    // An unrelated client is untouched.
    expect((await claimRefreshToken(other.token, 'gt_someone_else')).ok).toBe(true);
  });

  it('a stolen token presented by another client is NOT consumed (no free kill switch)', async () => {
    // The whole point of binding the client inside the atomic claim. An
    // attacker who has the token but not the victim client's credentials
    // could otherwise authenticate as their OWN registered client, burn the
    // victim's token, and take the connector down at will.
    const { token } = await mintRefreshToken(GRANT);

    const attacker = await claimRefreshToken(token, 'gt_attacker_client');
    expect(attacker.ok).toBe(false);
    if (attacker.ok) return;
    expect(attacker.reason).toBe('client_mismatch');

    // Nothing was consumed and nothing was revoked...
    expect(rows[0].used_at).toBeNull();
    expect(rows[0].revoked_at).toBeNull();
    // ...so the legitimate client's token still works.
    expect((await claimRefreshToken(token, GRANT.client_id)).ok).toBe(true);
  });

  it('two concurrent claims by the same client: neither strands it, the token is spent once', async () => {
    const { token } = await mintRefreshToken(GRANT);
    const [a, b] = await Promise.all([
      claimRefreshToken(token, GRANT.client_id),
      claimRefreshToken(token, GRANT.client_id),
    ]);
    // The same client refreshing twice at once is a retry, not theft.
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.grant.family_id).toBe(b.grant.family_id);
    expect(rows.filter((r) => r.used_at !== null)).toHaveLength(1);
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
  });

  // A client whose refresh response was lost retries with the token it still
  // holds. Burning the family for that sends a human back to log in.
  it('a retry inside the grace window is granted and burns nothing', async () => {
    const first = await mintRefreshToken(GRANT);
    expect((await claimRefreshToken(first.token, GRANT.client_id)).ok).toBe(true);
    const retry = await claimRefreshToken(first.token, GRANT.client_id);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.grant).toMatchObject({ client_id: GRANT.client_id, subject: GRANT.subject, scope: GRANT.scope });
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
  });

  it('the grace never applies to another client, a revoked token or an expired one', async () => {
    const first = await mintRefreshToken(GRANT);
    await claimRefreshToken(first.token, GRANT.client_id);

    const other = await claimRefreshToken(first.token, 'someone-else');
    expect(other).toMatchObject({ ok: false, reason: 'client_mismatch' });
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);

    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await claimRefreshToken(first.token, GRANT.client_id)).toMatchObject({ ok: false, reason: 'expired' });
    rows[0].expires_at = new Date(Date.now() + 60_000).toISOString();
    rows[0].revoked_at = new Date().toISOString();
    expect(await claimRefreshToken(first.token, GRANT.client_id)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('the grace window is exactly bounded and rejects nonsense timestamps', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(isWithinReuseGrace(new Date(now - REFRESH_REUSE_GRACE_MS).toISOString(), now)).toBe(true);
    expect(isWithinReuseGrace(new Date(now - REFRESH_REUSE_GRACE_MS - 1).toISOString(), now)).toBe(false);
    expect(isWithinReuseGrace(new Date(now + 1000).toISOString(), now)).toBe(false);
    expect(isWithinReuseGrace('not-a-date', now)).toBe(false);
  });
});

// ── Security review 2026-10-06: the retry grace must not fork the family, must
// not blind reuse detection, families must end, and our own store failures
// must never cost the client its token.
describe('OAuth refresh tokens — grace without forking, family cap, store errors', () => {
  beforeEach(() => {
    rows = [];
    failNext = null;
    clock = 0;
  });

  /** Claim + mint, the way the token route does. */
  async function rotate(token: string) {
    const claim = await claimRefreshToken(token, GRANT.client_id);
    if (!claim.ok) return { ok: false as const, reason: claim.reason };
    const minted = await mintRefreshToken({
      ...GRANT,
      family_id: claim.grant.family_id,
      family_started_at: claim.grant.family_started_at,
    });
    return { ok: true as const, token: minted.token };
  }
  const live = () => rows.filter((r) => r.used_at === null && r.revoked_at === null);

  it('replaying a rotated token N times inside the grace leaves exactly ONE live token', async () => {
    const first = await mintRefreshToken(GRANT);
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await rotate(first.token));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(live()).toHaveLength(1);
    // Only the LAST successor handed out is the live one.
    const last = results[results.length - 1];
    if (!last.ok) return;
    expect(live()[0].token_hash).toBe(await hashRefreshToken(last.token));
  });

  it('thief and owner both present inside the grace: the loser burns the family on next use', async () => {
    const stolen = await mintRefreshToken(GRANT);
    const thief = await rotate(stolen.token); // presents first
    const owner = await rotate(stolen.token); // owner's hourly refresh lands in the grace
    expect(thief.ok && owner.ok).toBe(true);
    if (!thief.ok || !owner.ok) return;

    // The owner's retry withdrew the thief's successor: one live token.
    expect(live()).toHaveLength(1);

    // The thief comes back with a revoked successor → family burned.
    const thiefAgain = await claimRefreshToken(thief.token, GRANT.client_id);
    expect(thiefAgain).toMatchObject({ ok: false, reason: 'revoked' });
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    // Nobody keeps access; a human re-consents.
    expect((await claimRefreshToken(owner.token, GRANT.client_id)).ok).toBe(false);
  });

  it('a normal claim revokes any other live token in the family (closes a mint race)', async () => {
    const first = await mintRefreshToken(GRANT);
    const claim = await claimRefreshToken(first.token, GRANT.client_id);
    if (!claim.ok) throw new Error('setup');
    // Simulate the race outcome: two live successors in one family.
    const s1 = await mintRefreshToken({ ...GRANT, family_id: claim.grant.family_id });
    const s2 = await mintRefreshToken({ ...GRANT, family_id: claim.grant.family_id });
    expect(live()).toHaveLength(2);

    expect((await claimRefreshToken(s1.token, GRANT.client_id)).ok).toBe(true);
    expect(live()).toHaveLength(0); // s2 withdrawn
    const other = await claimRefreshToken(s2.token, GRANT.client_id);
    expect(other).toMatchObject({ ok: false, reason: 'revoked' });
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
  });

  it('presenting a revoked token never burns ANOTHER client\'s view: wrong client still consumes nothing', async () => {
    const first = await mintRefreshToken(GRANT);
    rows[0].revoked_at = new Date().toISOString();
    const sibling = await mintRefreshToken({ ...GRANT, family_id: first.family_id });
    const res = await claimRefreshToken(first.token, 'attacker-client');
    expect(res).toMatchObject({ ok: false, reason: 'client_mismatch' });
    expect(rows.find((r) => r.token_hash !== rows[0].token_hash)?.revoked_at).toBeNull();
    void sibling;
  });

  it('a successor never outlives the 90-day family cap', async () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    expect(refreshExpiryMs(start, start)).toBe(start + REFRESH_TTL_MS);
    // Day 80 of the family: 30 more days would be day 110; capped at day 90.
    expect(refreshExpiryMs(start + 80 * day, start)).toBe(start + REFRESH_FAMILY_MAX_AGE_MS);

    const first = await mintRefreshToken(GRANT);
    rows[0].created_at = new Date(Date.now() - 80 * day).toISOString();
    const claim = await claimRefreshToken(first.token, GRANT.client_id);
    if (!claim.ok) throw new Error('setup');
    const next = await mintRefreshToken({
      ...GRANT, family_id: claim.grant.family_id, family_started_at: claim.grant.family_started_at,
    });
    const left = Date.parse(next.expires_at) - Date.now();
    expect(left).toBeLessThanOrEqual(10 * day + 1000);
    expect(left).toBeGreaterThan(9 * day);
  });

  it('a family past its cap is refused and revoked, however fresh the token', async () => {
    const first = await mintRefreshToken(GRANT);
    rows[0].created_at = new Date(Date.now() - REFRESH_FAMILY_MAX_AGE_MS - 1000).toISOString();
    const res = await claimRefreshToken(first.token, GRANT.client_id);
    expect(res).toMatchObject({ ok: false, reason: 'expired' });
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
  });

  it('an RPC failure is store_error and consumes or burns nothing', async () => {
    const first = await mintRefreshToken(GRANT);
    failNext = (op) => (op === 'rpc' ? { code: '57014', message: 'statement timeout' } : undefined);
    expect(await claimRefreshToken(first.token, GRANT.client_id)).toMatchObject({ ok: false, reason: 'store_error' });
    expect(rows[0]).toMatchObject({ used_at: null, revoked_at: null });
    failNext = null;
    expect((await claimRefreshToken(first.token, GRANT.client_id)).ok).toBe(true);
  });

  it('a failed read-back is store_error, not "unknown token"', async () => {
    const first = await mintRefreshToken(GRANT);
    await claimRefreshToken(first.token, GRANT.client_id);
    failNext = (op) => (op === 'select' ? { code: 'XX000', message: 'boom' } : undefined);
    expect(await claimRefreshToken(first.token, GRANT.client_id)).toMatchObject({ ok: false, reason: 'store_error' });
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
  });

  it('if the grace withdrawal cannot be written, no second live token is granted', async () => {
    const first = await mintRefreshToken(GRANT);
    const a = await rotate(first.token);
    expect(a.ok).toBe(true);
    failNext = (op) => (op === 'update' ? { code: 'XX000', message: 'boom' } : undefined);
    expect(await claimRefreshToken(first.token, GRANT.client_id)).toMatchObject({ ok: false, reason: 'store_error' });
    failNext = null;
    expect(live()).toHaveLength(1);
  });

  it('revokeRefreshTokensForClient reports a failed write instead of swallowing it', async () => {
    await mintRefreshToken(GRANT);
    failNext = (op) => (op === 'update' ? { code: 'XX000', message: 'boom' } : undefined);
    expect(await revokeRefreshTokensForClient(GRANT.client_id)).toBe(false);
    failNext = null;
    expect(await revokeRefreshTokensForClient(GRANT.client_id)).toBe(true);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
  });

  it('the fake rejects columns the production table does not have', async () => {
    const { createServiceClient } = await import('@/lib/supabase');
    const sb = createServiceClient() as unknown as { from: (t: string) => { select: (c: string) => unknown } };
    expect(() => sb.from('oauth_refresh_tokens').select('id')).toThrow(/no column "id"/);
    expect(() => sb.from('oauth_refresh_tokens').select('audience')).toThrow(/no column/);
  });
});
