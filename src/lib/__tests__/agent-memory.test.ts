import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the service-client so we don't hit Supabase. Each test can grab the
// underlying query-chain mock and assert call arguments.
const chainState = {
  fromCalls: [] as string[],
  upsertData: null as unknown,
  selectData: null as unknown,
  selectError: null as unknown,
  deleteCount: 0,
  deleteError: null as unknown,
};

vi.mock('../supabase', () => {
  // A flexible builder that short-circuits once we reach the chain terminator
  // our real code uses. Chain methods return `this`; terminators return a
  // Promise-like result based on chainState.
  function buildSelectChain() {
    const chain = {
      eq: () => chain,
      order: () => chain,
      limit: async () => ({
        data: Array.isArray(chainState.selectData) ? chainState.selectData : [],
        error: chainState.selectError,
      }),
      maybeSingle: async () => ({
        data: chainState.selectData,
        error: chainState.selectError,
      }),
    };
    return chain;
  }
  function buildDeleteChain() {
    const chain = {
      eq: () => chain,
      lt: async () => ({
        error: chainState.deleteError,
        count: chainState.deleteCount,
      }),
      // `.delete().eq().eq()` chain is awaited directly for deleteMemory.
      then: (resolve: (v: { error: unknown }) => unknown) =>
        resolve({ error: chainState.deleteError }),
    };
    return chain;
  }

  return {
    createServiceClient: () => ({
      from: (table: string) => {
        chainState.fromCalls.push(table);
        return {
          upsert: (row: unknown, _opts: unknown) => ({
            select: () => ({
              single: async () => ({ data: chainState.upsertData ?? row, error: null }),
            }),
          }),
          select: () => buildSelectChain(),
          delete: (_opts?: { count?: 'exact' }) => buildDeleteChain(),
        };
      },
    }),
  };
});

import {
  setMemory,
  getMemory,
  getRecord,
  listMemory,
  deleteMemory,
  cleanExpired,
  buildSharedContextBlock,
} from '../agent-memory';

describe('agent-memory', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    chainState.fromCalls = [];
    chainState.upsertData = null;
    chainState.selectData = null;
    chainState.selectError = null;
    chainState.deleteCount = 0;
    chainState.deleteError = null;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it('setMemory hits the agent_memory table with the right shape', async () => {
    const result = await setMemory('keisha', 'user_mood', 'stressed about CR3 AR', {
      metadata: { source: 'chat', confidence: 0.8 },
    });
    expect(chainState.fromCalls).toContain('agent_memory');
    expect(result).toMatchObject({ agent_name: 'keisha', key: 'user_mood', value: 'stressed about CR3 AR' });
  });

  it('getMemory returns the value of an existing record', async () => {
    chainState.selectData = {
      id: 'abc',
      agent_name: 'shared',
      key: 'active_thesis',
      value: { symbol: 'NVDA', thesis: 'long' },
      metadata: {},
      created_at: '2026-04-21T00:00:00Z',
      updated_at: '2026-04-21T00:00:00Z',
      expires_at: null,
    };
    const value = await getMemory<{ symbol: string; thesis: string }>('shared', 'active_thesis');
    expect(value).toEqual({ symbol: 'NVDA', thesis: 'long' });
  });

  it('getMemory returns null for expired records', async () => {
    chainState.selectData = {
      id: 'abc',
      agent_name: 'shared',
      key: 'old_note',
      value: 'stale',
      metadata: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z', // past
    };
    const value = await getMemory('shared', 'old_note');
    expect(value).toBeNull();
  });

  it('getRecord preserves metadata + timestamps', async () => {
    chainState.selectData = {
      id: 'r1',
      agent_name: 'apollo',
      key: 'x',
      value: 42,
      metadata: { source: 'scanner' },
      created_at: 't1',
      updated_at: 't2',
      expires_at: null,
    };
    const rec = await getRecord<number>('apollo', 'x');
    expect(rec?.metadata).toEqual({ source: 'scanner' });
    expect(rec?.value).toBe(42);
  });

  it('listMemory skips expired rows', async () => {
    chainState.selectData = [
      {
        id: '1',
        agent_name: 'shared',
        key: 'a',
        value: 'live',
        metadata: {},
        created_at: 't',
        updated_at: 't',
        expires_at: null,
      },
      {
        id: '2',
        agent_name: 'shared',
        key: 'b',
        value: 'stale',
        metadata: {},
        created_at: 't',
        updated_at: 't',
        expires_at: '2020-01-01T00:00:00Z',
      },
    ];
    const rows = await listMemory('shared');
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('a');
  });

  it('deleteMemory returns true on success', async () => {
    chainState.deleteError = null;
    expect(await deleteMemory('keisha', 'whatever')).toBe(true);
  });

  it('cleanExpired returns the deleted count', async () => {
    chainState.deleteCount = 5;
    const { deleted } = await cleanExpired();
    expect(deleted).toBe(5);
  });

  it('returns null/empty when Supabase env is unconfigured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await setMemory('x', 'y', 'z')).toBeNull();
    expect(await getMemory('x', 'y')).toBeNull();
    expect(await listMemory('x')).toEqual([]);
    expect(await deleteMemory('x', 'y')).toBe(false);
    expect((await cleanExpired()).deleted).toBe(0);
  });

  it('buildSharedContextBlock formats shared memory for prompt injection', async () => {
    chainState.selectData = [
      {
        id: '1',
        agent_name: 'shared',
        key: 'user_mood',
        value: 'stressed about CR3 AR',
        metadata: {},
        created_at: 't',
        updated_at: 't',
        expires_at: null,
      },
      {
        id: '2',
        agent_name: 'shared',
        key: 'active_thesis',
        value: { symbol: 'NVDA', direction: 'long' },
        metadata: {},
        created_at: 't',
        updated_at: 't',
        expires_at: null,
      },
    ];
    const block = await buildSharedContextBlock();
    expect(block).toContain('SHARED AGENT MEMORY');
    expect(block).toContain('user_mood: stressed about CR3 AR');
    expect(block).toContain('active_thesis: {"symbol":"NVDA"');
  });

  it('buildSharedContextBlock returns empty string when nothing is stored', async () => {
    chainState.selectData = [];
    const block = await buildSharedContextBlock();
    expect(block).toBe('');
  });
});
