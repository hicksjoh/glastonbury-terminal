import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeFakeSupabase, MISSING_TABLE_ERROR, type FakeSupabase, type Row } from './helpers/fake-supabase';

/**
 * OAuth client housekeeping: the prune predicate (pure), the prune itself,
 * the bounded client list, the 24h registration count, and the
 * revoke → refresh-token cascade.
 */

const holder = vi.hoisted(() => ({ fake: null as unknown as { client: unknown } }));
vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => holder.fake.client,
}));

import {
  isPrunableClient,
  isPreRegisteredClient,
  pruneStaleClients,
  listClients,
  listClientsPage,
  countRecentClients,
  revokeClient,
  CLIENT_LIST_DEFAULT_LIMIT,
  CLIENT_LIST_MAX_LIMIT,
  CLIENT_PRUNE_BATCH,
  MAX_NEW_CLIENTS_PER_24H,
} from '../oauth/clients';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

interface Shape {
  last_used_at?: string | null;
  client_name: string;
  created_at: string;
  revoked_at: string | null;
  metadata: Record<string, unknown>;
}
const c = (over: Partial<Shape>): Shape => ({
  client_name: 'Claude',
  created_at: ago(100 * 24 * HOUR),
  revoked_at: null,
  metadata: {},
  ...over,
});

describe('isPrunableClient (pure selection predicate)', () => {
  it('NEVER prunes a live, non-e2e client — however old or unused', () => {
    expect(isPrunableClient(c({}), NOW)).toBe(false);
    expect(isPrunableClient(c({ client_name: 'Glastonbury Terminal', created_at: ago(900 * 24 * HOUR) }), NOW)).toBe(false);
  });

  it('prunes an anonymous registration that was never used, after 24h', () => {
    const anon = { metadata: { registered_via: 'open-dcr' } };
    expect(isPrunableClient(c({ ...anon, last_used_at: null, created_at: ago(25 * HOUR) }), NOW)).toBe(true);
    // Not yet 24h old: a connector may still be mid-setup.
    expect(isPrunableClient(c({ ...anon, last_used_at: null, created_at: ago(23 * HOUR) }), NOW)).toBe(false);
    // Used even once: kept forever.
    expect(isPrunableClient(c({ ...anon, last_used_at: ago(HOUR), created_at: ago(900 * 24 * HOUR) }), NOW)).toBe(false);
    // Usage unknown (field not selected): kept.
    expect(isPrunableClient(c({ ...anon, created_at: ago(900 * 24 * HOUR) }), NOW)).toBe(false);
    // Session- or token-registered and unused: kept — only anonymous rows qualify.
    expect(isPrunableClient(c({ metadata: { registered_via: 'session' }, last_used_at: null }), NOW)).toBe(false);
    expect(isPrunableClient(c({ metadata: {}, last_used_at: null }), NOW)).toBe(false);
  });

  it('prunes a client revoked more than 24h ago', () => {
    expect(isPrunableClient(c({ revoked_at: ago(25 * HOUR) }), NOW)).toBe(true);
  });

  it('keeps a client revoked less than 24h ago (un-revoke window)', () => {
    expect(isPrunableClient(c({ revoked_at: ago(23 * HOUR) }), NOW)).toBe(false);
    expect(isPrunableClient(c({ revoked_at: ago(24 * HOUR) }), NOW)).toBe(false); // boundary: not OLDER than
    expect(isPrunableClient(c({ revoked_at: ago(1000) }), NOW)).toBe(false);
  });

  it('prunes an e2e- client created more than 24h ago, revoked or not', () => {
    expect(isPrunableClient(c({ client_name: 'e2e-revoke-flow-1759700000000', created_at: ago(25 * HOUR) }), NOW)).toBe(true);
    expect(
      isPrunableClient(
        c({ client_name: 'e2e-revoke-flow-1759700000000', created_at: ago(25 * HOUR), revoked_at: ago(HOUR) }),
        NOW,
      ),
    ).toBe(true);
  });

  it('keeps an e2e- client younger than 24h (a run may still be using it)', () => {
    expect(isPrunableClient(c({ client_name: 'e2e-wrong-pkce-1', created_at: ago(2 * HOUR) }), NOW)).toBe(false);
  });

  it('the e2e rule is a strict, case-sensitive PREFIX match', () => {
    for (const client_name of ['E2E-thing', 'my-e2e-client', 'e2e', 'e2eclient', ' e2e-x', 'Claude e2e-']) {
      expect(isPrunableClient(c({ client_name, created_at: ago(72 * HOUR) }), NOW)).toBe(false);
    }
  });

  it('NEVER prunes a pre-registered client, even long-revoked or e2e-named', () => {
    const old = ago(400 * 24 * HOUR);
    expect(isPrunableClient(c({ client_name: 'Claude.app (pre-registered)', revoked_at: old }), NOW)).toBe(false);
    expect(isPrunableClient(c({ client_name: 'Claude.app (preregistered)', revoked_at: old }), NOW)).toBe(false);
    expect(isPrunableClient(c({ client_name: 'x', revoked_at: old, metadata: { pre_registered: true } }), NOW)).toBe(false);
    expect(
      isPrunableClient(c({ client_name: 'e2e-but (Pre-Registered)', created_at: old, revoked_at: old }), NOW),
    ).toBe(false);
    expect(isPreRegisteredClient({ client_name: 'Claude.app (pre-registered)', metadata: {} })).toBe(true);
    expect(isPreRegisteredClient({ client_name: 'Claude', metadata: {} })).toBe(false);
    // A truthy-but-not-true flag does not count.
    expect(isPreRegisteredClient({ client_name: 'Claude', metadata: { pre_registered: 'no' } })).toBe(false);
  });

  it('a DYNAMICALLY registered client cannot dodge the prune by naming itself pre-registered', () => {
    const old = ago(400 * 24 * HOUR);
    for (const registered_via of ['open-dcr', 'dev', 'session', 'token']) {
      const spoof = c({
        client_name: 'Claude.app (pre-registered)',
        revoked_at: old,
        metadata: { registered_via, pre_registered: true },
      });
      expect(isPreRegisteredClient(spoof)).toBe(false);
      expect(isPrunableClient(spoof, NOW)).toBe(true);
    }
  });

  it('unparseable timestamps keep the row', () => {
    expect(isPrunableClient(c({ revoked_at: 'not-a-date' }), NOW)).toBe(false);
    expect(isPrunableClient(c({ client_name: 'e2e-x', created_at: 'garbage' }), NOW)).toBe(false);
  });
});

describe('store-backed client housekeeping', () => {
  let fake: FakeSupabase;
  const clients = (): Row[] => fake.tables.oauth_clients ?? [];
  const names = () => clients().map(r => r.client_name).sort();

  function seed(rows: (Partial<Shape> & { client_id: string })[]) {
    fake = makeFakeSupabase({
      oauth_clients: rows.map((r, i) => ({ id: `id-${i}`, ...c(r), client_id: r.client_id })),
    });
    holder.fake = fake;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pruneStaleClients', () => {
    beforeEach(() => {
      seed([
        { client_id: 'gt_live', client_name: 'Claude' },
        { client_id: 'gt_pre', client_name: 'Claude.app (pre-registered)', revoked_at: ago(90 * 24 * HOUR) },
        { client_id: 'gt_revoked_old', client_name: 'Old connector', revoked_at: ago(48 * HOUR) },
        { client_id: 'gt_revoked_new', client_name: 'Just revoked', revoked_at: ago(HOUR) },
        { client_id: 'gt_e2e_old', client_name: 'e2e-revoke-flow-1', created_at: ago(30 * HOUR) },
        { client_id: 'gt_e2e_old_revoked', client_name: 'e2e-revoke-flow-2', created_at: ago(30 * HOUR), revoked_at: ago(29 * HOUR) },
        { client_id: 'gt_e2e_new', client_name: 'e2e-revoke-flow-3', created_at: ago(HOUR) },
      ]);
      fake.tables.oauth_refresh_tokens = [
        { id: 'r1', client_id: 'gt_e2e_old', token_hash: 'h1' },
        { id: 'r2', client_id: 'gt_live', token_hash: 'h2' },
      ];
    });

    it('deletes exactly the stale rows and nothing else', async () => {
      const res = await pruneStaleClients(NOW);
      expect(res.deleted).toBe(3);
      expect(names()).toEqual(['Claude', 'Claude.app (pre-registered)', 'Just revoked', 'e2e-revoke-flow-3']);
    });

    it('removes refresh tokens of deleted clients only', async () => {
      await pruneStaleClients(NOW);
      expect(fake.tables.oauth_refresh_tokens.map(r => r.client_id)).toEqual(['gt_live']);
    });

    it('is idempotent', async () => {
      await pruneStaleClients(NOW);
      const again = await pruneStaleClients(NOW);
      expect(again.deleted).toBe(0);
      expect(clients()).toHaveLength(4);
    });

    it('a scan error throws and deletes nothing', async () => {
      fake.failWith((table, op) => (table === 'oauth_clients' && op === 'select' ? { message: 'timeout' } : undefined));
      await expect(pruneStaleClients(NOW)).rejects.toThrow(/prune/);
      expect(clients()).toHaveLength(7);
      expect(fake.log.some(l => l.op === 'delete')).toBe(false);
    });

    it('a delete error throws', async () => {
      fake.failWith((table, op) => (table === 'oauth_clients' && op === 'delete' ? { message: 'denied' } : undefined));
      await expect(pruneStaleClients(NOW)).rejects.toThrow(/prune delete failed/);
      expect(clients()).toHaveLength(7);
    });

    it('still prunes clients when the refresh-token table is not migrated', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fake.failWith(table => (table === 'oauth_refresh_tokens' ? MISSING_TABLE_ERROR : undefined));
      const res = await pruneStaleClients(NOW);
      expect(res.deleted).toBe(3);
    });

    it('never deletes more than one batch per pass', async () => {
      seed(
        Array.from({ length: CLIENT_PRUNE_BATCH + 40 }, (_, i) => ({
          client_id: `gt_e2e_${i}`,
          client_name: `e2e-revoke-flow-${i}`,
          created_at: ago(48 * HOUR),
        })),
      );
      const res = await pruneStaleClients(NOW);
      expect(res.deleted).toBe(CLIENT_PRUNE_BATCH);
      expect(clients()).toHaveLength(40);
    });
  });

  describe('listClients is bounded and newest-first', () => {
    beforeEach(() => {
      seed(
        Array.from({ length: 342 }, (_, i) => ({
          client_id: `gt_${i}`,
          client_name: `e2e-revoke-flow-${i}`,
          // i = 0 is the oldest, i = 341 the newest
          created_at: new Date(NOW - (342 - i) * HOUR).toISOString(),
        })),
      );
    });

    it('defaults to one capped page, newest first', async () => {
      const list = await listClients();
      expect(list).toHaveLength(CLIENT_LIST_DEFAULT_LIMIT);
      expect(list[0].client_id).toBe('gt_341');
      expect(list[1].client_id).toBe('gt_340');
    });

    it('pages with limit/offset and reports has_more', async () => {
      const p1 = await listClientsPage({ limit: 100, offset: 0 });
      expect(p1.clients).toHaveLength(100);
      expect(p1.has_more).toBe(true);
      const last = await listClientsPage({ limit: 100, offset: 300 });
      expect(last.clients).toHaveLength(42);
      expect(last.has_more).toBe(false);
      expect(last.clients[41].client_id).toBe('gt_0');
    });

    it('clamps hostile paging input', async () => {
      expect((await listClientsPage({ limit: 1_000_000 })).limit).toBe(CLIENT_LIST_MAX_LIMIT);
      expect((await listClientsPage({ limit: 0 })).limit).toBe(1);
      expect((await listClientsPage({ limit: -5, offset: -9 })).offset).toBe(0);
      expect((await listClientsPage({ limit: Number.NaN, offset: Number.NaN })).limit).toBe(CLIENT_LIST_DEFAULT_LIMIT);
    });

    it('surfaces a store error instead of returning an empty list', async () => {
      fake.failWith(() => ({ message: 'boom' }));
      await expect(listClients()).rejects.toThrow(/list failed/);
    });
  });

  describe('countRecentClients (registration flood cap input)', () => {
    it('counts only non-revoked ANONYMOUS registrations from the last 24h', async () => {
      const anon = { metadata: { registered_via: 'open-dcr' } };
      seed([
        { client_id: 'a', created_at: ago(HOUR), ...anon },
        { client_id: 'b', created_at: ago(23 * HOUR), ...anon },
        { client_id: 'c', created_at: ago(25 * HOUR), ...anon },
        { client_id: 'd', created_at: ago(HOUR), revoked_at: ago(1000), ...anon },
        // Session-registered e2e clients must not eat the anonymous cap.
        { client_id: 'e', created_at: ago(HOUR), metadata: { registered_via: 'session' } },
        { client_id: 'f', created_at: ago(HOUR), metadata: {} },
      ]);
      expect(await countRecentClients(NOW)).toBe(2);
      expect(MAX_NEW_CLIENTS_PER_24H).toBeGreaterThan(10);
      expect(MAX_NEW_CLIENTS_PER_24H).toBeLessThanOrEqual(100);
    });

    it('throws on a store error so the caller can fail closed', async () => {
      seed([]);
      fake.failWith(() => ({ message: 'boom' }));
      await expect(countRecentClients(NOW)).rejects.toThrow(/recent count failed/);
    });
  });

  describe('revokeClient cascades to refresh tokens', () => {
    beforeEach(() => {
      seed([{ client_id: 'gt_a' }, { client_id: 'gt_b' }]);
      fake.tables.oauth_refresh_tokens = [
        { id: 'r1', client_id: 'gt_a', family_id: 'f1', token_hash: 'h1', revoked_at: null },
        { id: 'r2', client_id: 'gt_a', family_id: 'f2', token_hash: 'h2', revoked_at: null },
        { id: 'r3', client_id: 'gt_b', family_id: 'f3', token_hash: 'h3', revoked_at: null },
      ];
    });

    it('revokes every family of the revoked client and leaves other clients alone', async () => {
      expect(await revokeClient('gt_a')).toBe(true);
      const rt = fake.tables.oauth_refresh_tokens;
      expect(rt.filter(r => r.client_id === 'gt_a').every(r => r.revoked_at !== null)).toBe(true);
      expect(rt.find(r => r.client_id === 'gt_b')?.revoked_at).toBeNull();
      expect(clients().find(r => r.client_id === 'gt_a')?.revoked_at).not.toBeNull();
    });

    it('still revokes the client when the refresh-token table is not migrated', async () => {
      fake.failWith(table => (table === 'oauth_refresh_tokens' ? MISSING_TABLE_ERROR : undefined));
      expect(await revokeClient('gt_a')).toBe(true);
      expect(clients().find(r => r.client_id === 'gt_a')?.revoked_at).not.toBeNull();
    });

    it('unknown client → false', async () => {
      expect(await revokeClient('gt_nope')).toBe(false);
    });
  });
});
