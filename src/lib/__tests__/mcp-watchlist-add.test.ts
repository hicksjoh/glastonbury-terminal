import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * terminal_add_to_watchlist must be safe to call for a symbol that is already
 * on the watchlist. Telos (and Keisha) call it whenever Wes asks to watch a
 * ticker; before this fix a repeat symbol came back as
 *   watchlist insert failed: duplicate key value violates unique constraint "watchlist_symbol_key"
 * Now a repeat keeps the row, refreshes its price, and updates the note only
 * when a new one is given.
 *
 * The test drives the real MCP server through an in-memory MCP client, so it
 * exercises the same tool call an MCP client sends.
 */

type Row = {
  symbol: string;
  company_name: string | null;
  current_price: number | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

const DUPLICATE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "watchlist_symbol_key"',
};

// A tiny stand-in for the `watchlist` table with its unique key on symbol.
const table = new Map<string, Row>();
let hideNextLookup = false; // simulate a row created between lookup and insert
let failInsert: { code?: string; message: string } | null = null;

function from(name: string) {
  if (name !== 'watchlist') throw new Error(`unexpected table ${name}`);
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Partial<Row> = {};
  let symbol: string | null = null;
  const run = (maybe: boolean) => {
    if (op === 'insert') {
      if (failInsert) return Promise.resolve({ data: null, error: failInsert });
      const row = payload as Row;
      if (table.has(row.symbol)) return Promise.resolve({ data: null, error: DUPLICATE });
      const stored = { created_at: '2026-11-24T00:00:00Z', ...row };
      table.set(row.symbol, stored);
      return Promise.resolve({ data: { ...stored }, error: null });
    }
    const existing = symbol ? table.get(symbol) : undefined;
    if (op === 'update') {
      if (!existing) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      const merged = { ...existing, ...payload };
      table.set(existing.symbol, merged);
      return Promise.resolve({ data: { ...merged }, error: null });
    }
    if (hideNextLookup) {
      hideNextLookup = false;
      return Promise.resolve({ data: null, error: null });
    }
    if (!existing && !maybe) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    return Promise.resolve({ data: existing ? { ...existing } : null, error: null });
  };
  const q = {
    select: () => q,
    insert: (row: Partial<Row>) => { op = 'insert'; payload = row; return q; },
    update: (patch: Partial<Row>) => { op = 'update'; payload = patch; return q; },
    eq: (_col: string, value: string) => { symbol = value; return q; },
    maybeSingle: () => run(true),
    single: () => run(false),
  };
  return q;
}

vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({ from }) }));
vi.mock('@/lib/alpaca', () => ({
  alpacaFetch: vi.fn(async (path: string) => ({ name: path.endsWith('/NVDA') ? 'NVIDIA Corporation' : 'Some Co' })),
  getAccount: vi.fn(),
  getPositions: vi.fn(),
}));
vi.mock('@/lib/watchlist-quotes', () => ({
  getLiveQuotes: vi.fn(async (symbols: string[]) => new Map(symbols.map(s => [s, {
    symbol: s, price: 142.5, prevClose: 140, changePct: 1.79, asOf: '2026-11-24T02:59:00Z', source: 'alpaca',
  }]))),
}));
vi.mock('@/lib/agent-memory', () => ({ setMemory: vi.fn(), getMemory: vi.fn(), listMemory: vi.fn() }));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildTerminalMcpServer } from '../mcp/server';

async function add(args: { symbol: string; notes?: string }) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = buildTerminalMcpServer();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  const res = await client.callTool({ name: 'terminal_add_to_watchlist', arguments: args });
  await client.close();
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(text); } catch { /* error text */ }
  return { isError: res.isError === true, text, body };
}

describe('terminal_add_to_watchlist', () => {
  beforeEach(() => {
    table.clear();
    hideNextLookup = false;
    failInsert = null;
  });

  it('adds a new symbol, uppercased, with its name and live price', async () => {
    const r = await add({ symbol: 'nvda', notes: 'AI capex' });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({
      already_watching: false,
      added: { symbol: 'NVDA', company_name: 'NVIDIA Corporation', current_price: 142.5, notes: 'AI capex' },
    });
    expect(table.get('NVDA')?.notes).toBe('AI capex');
  });

  it('does not fail for a symbol already on the watchlist, and keeps its note', async () => {
    table.set('NVDA', { symbol: 'NVDA', company_name: 'NVIDIA Corporation', current_price: 120, notes: 'AI capex' });
    const r = await add({ symbol: 'NVDA' });
    expect(r.isError).toBe(false);
    expect(r.text).not.toMatch(/duplicate key/);
    expect(r.body).toMatchObject({ already_watching: true, item: { symbol: 'NVDA', notes: 'AI capex', current_price: 142.5 } });
    expect(table.size).toBe(1);
    expect(table.get('NVDA')?.notes).toBe('AI capex');
    expect(table.get('NVDA')?.current_price).toBe(142.5);
  });

  it('updates the note when a repeat symbol comes with a new one', async () => {
    table.set('NVDA', { symbol: 'NVDA', company_name: null, current_price: 120, notes: 'old note' });
    const r = await add({ symbol: 'nvda', notes: 'earnings 11/26' });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ already_watching: true, item: { notes: 'earnings 11/26', company_name: 'NVIDIA Corporation' } });
    expect(table.get('NVDA')?.notes).toBe('earnings 11/26');
  });

  it('treats a row created between the lookup and the insert as already watched', async () => {
    table.set('NVDA', { symbol: 'NVDA', company_name: 'NVIDIA Corporation', current_price: 120, notes: null });
    hideNextLookup = true;
    const r = await add({ symbol: 'NVDA', notes: 'from Telos' });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ already_watching: true, item: { symbol: 'NVDA', notes: 'from Telos' } });
  });

  it('still reports other database errors', async () => {
    failInsert = { code: '42501', message: 'permission denied for table watchlist' };
    const r = await add({ symbol: 'AAPL' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/permission denied/);
  });

  it('rejects something that is not a ticker', async () => {
    const r = await add({ symbol: 'not a $ym' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/invalid ticker symbol/);
  });
});
