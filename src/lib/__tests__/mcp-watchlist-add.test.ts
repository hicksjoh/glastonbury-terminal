// terminal_add_to_watchlist must be idempotent.
//
// Regression: adding a symbol that was already on the watchlist surfaced the
// raw Postgres error to every MCP client (the Telos page showed
// `watchlist insert failed: duplicate key value violates unique constraint
// "watchlist_symbol_key"`). watchlist.symbol is UNIQUE, so a second add is
// "you already watch this", not a failure; a new note on that second add is
// the user telling us why they watch it now.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

type Row = Record<string, unknown>;
type PgError = { code?: string; message: string };

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Row[],
    inserts: 0,
    // Simulates a concurrent add of the same symbol landing between our
    // lookup and our insert.
    raceOnInsert: false,
  };

  class Query implements PromiseLike<{ data: unknown; error: PgError | null }> {
    private op: 'select' | 'insert' | 'update' = 'select';
    private payload: Row | null = null;
    private filters: [string, unknown][] = [];
    private one = false;

    select() { return this; }
    insert(r: Row) { this.op = 'insert'; this.payload = r; return this; }
    update(r: Row) { this.op = 'update'; this.payload = r; return this; }
    eq(col: string, v: unknown) { this.filters.push([col, v]); return this; }
    limit() { return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }

    private run(): { data: unknown; error: PgError | null } {
      const match = (r: Row) => this.filters.every(([c, v]) => r[c] === v);
      if (this.op === 'insert') {
        state.inserts++;
        const p = this.payload as Row;
        if (state.raceOnInsert) {
          state.raceOnInsert = false;
          state.rows.push({ id: 'raced', symbol: p.symbol, notes: null });
        }
        if (state.rows.some(r => r.symbol === p.symbol)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "watchlist_symbol_key"' },
          };
        }
        const row = { id: `id-${state.rows.length + 1}`, ...p };
        state.rows.push(row);
        return { data: row, error: null };
      }
      const hit = state.rows.filter(match);
      if (this.op === 'update') hit.forEach(r => Object.assign(r, this.payload));
      return { data: this.one ? (hit[0] ?? null) : hit, error: null };
    }

    then<A = { data: unknown; error: PgError | null }, B = never>(
      ok?: ((v: { data: unknown; error: PgError | null }) => A | PromiseLike<A>) | null,
      bad?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.run()).then(ok, bad);
    }
  }

  return { state, Query };
});

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: () => new h.Query() }),
}));
vi.mock('@/lib/alpaca', () => ({
  alpacaFetch: vi.fn(async () => ({ name: 'NVIDIA Corporation' })),
  getAccount: vi.fn(),
  getPositions: vi.fn(),
}));
vi.mock('@/lib/watchlist-quotes', () => ({
  getLiveQuotes: vi.fn(async (syms: string[]) => new Map(syms.map(s => [s, { symbol: s, price: 181.5 }]))),
}));

import { buildTerminalMcpServer } from '@/lib/mcp/server';

async function add(args: { symbol: string; notes?: string }) {
  const server = buildTerminalMcpServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  const res = (await client.callTool({ name: 'terminal_add_to_watchlist', arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  await client.close();
  const text = res.content[0]?.text ?? '';
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(text); } catch { /* error text */ }
  return { isError: !!res.isError, text, body };
}

beforeEach(() => {
  h.state.rows = [];
  h.state.inserts = 0;
  h.state.raceOnInsert = false;
});

describe('terminal_add_to_watchlist', () => {
  it('adds a new symbol', async () => {
    const r = await add({ symbol: 'nvda', notes: 'earnings on the 29th' });
    expect(r.isError).toBe(false);
    expect(r.body?.already_watching).toBe(false);
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0]).toMatchObject({ symbol: 'NVDA', notes: 'earnings on the 29th', company_name: 'NVIDIA Corporation' });
  });

  it('treats a symbol that is already watched as success, not a duplicate-key error', async () => {
    h.state.rows.push({ id: 'a', symbol: 'NVDA', notes: 'AI capex' });
    const r = await add({ symbol: 'NVDA' });
    expect(r.isError).toBe(false);
    expect(r.text).not.toMatch(/duplicate key/);
    expect(r.body?.already_watching).toBe(true);
    expect(h.state.inserts).toBe(0);
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0].notes).toBe('AI capex'); // no note given: the old one stays
  });

  it('matches case-insensitively, since symbols are stored uppercased', async () => {
    h.state.rows.push({ id: 'a', symbol: 'NVDA', notes: null });
    const r = await add({ symbol: ' nvda ' });
    expect(r.isError).toBe(false);
    expect(r.body?.already_watching).toBe(true);
  });

  it('saves a new note on a re-add and reports the note it replaced', async () => {
    h.state.rows.push({ id: 'a', symbol: 'NVDA', notes: 'AI capex' });
    const r = await add({ symbol: 'NVDA', notes: 'earnings on the 29th' });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ already_watching: true, note_updated: true, previous_note: 'AI capex' });
    expect(h.state.rows[0].notes).toBe('earnings on the 29th');
  });

  it('survives losing a race to a concurrent add of the same symbol', async () => {
    h.state.raceOnInsert = true;
    const r = await add({ symbol: 'NVDA', notes: 'why' });
    expect(r.isError).toBe(false);
    expect(r.body?.already_watching).toBe(true);
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0].notes).toBe('why');
  });

  it('still rejects an invalid ticker', async () => {
    const r = await add({ symbol: 'NOT A TICKER' });
    expect(r.isError).toBe(true);
    expect(h.state.inserts).toBe(0);
  });
});
