// Adding a symbol that is already watched must never surface the raw
// duplicate-key error, on any of the paths that add to the watchlist.
//
// The MCP tool was fixed in #39. The Keisha in-app tool and the
// /api/keisha/actions route already look the symbol up before inserting, but
// a row added between that lookup and the insert (two adds at once, or a
// lookup that errored and so returned nothing) still came back as
// `duplicate key value violates unique constraint "watchlist_symbol_key"`:
// as a failed tool result in chat, and as a 500 from the route.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

type PgError = { code?: string; message: string };

const h = vi.hoisted(() => {
  const state = {
    rows: [] as { symbol: string }[],
    hideLookup: false,           // the lookup misses a row that is there
    lookupError: null as PgError | null,
    insertError: null as PgError | null,
    inserts: 0,
  };
  const DUPLICATE: PgError = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "watchlist_symbol_key"',
  };
  function from() {
    let op: 'select' | 'insert' = 'select';
    let payload: { symbol: string } | null = null;
    let symbol = '';
    const run = () => {
      if (op === 'insert') {
        state.inserts++;
        if (state.insertError) return { data: null, error: state.insertError };
        if (state.rows.some(r => r.symbol === payload!.symbol)) return { data: null, error: DUPLICATE };
        state.rows.push({ symbol: payload!.symbol });
        return { data: null, error: null };
      }
      if (state.lookupError) return { data: null, error: state.lookupError };
      if (state.hideLookup) return { data: [], error: null };
      return { data: state.rows.filter(r => r.symbol === symbol), error: null };
    };
    const q = {
      select: () => q,
      insert: (row: { symbol: string }) => { op = 'insert'; payload = row; return q; },
      eq: (_c: string, v: string) => { symbol = v; return q; },
      limit: () => q,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }
  return { state, from, DUPLICATE };
});

vi.mock('@/lib/supabase', () => ({ createServiceClient: () => ({ from: h.from }) }));
vi.mock('@/lib/fmp-client', () => ({
  getProfile: vi.fn(async () => ({ companyName: 'NVIDIA Corporation', price: 142.5 })),
  getQuote: vi.fn(),
}));
vi.mock('@/lib/watchlist-quotes', () => ({ getLiveQuotes: vi.fn(async () => new Map()) }));
vi.mock('@/lib/rate-limit-durable', () => ({
  getRateLimitIdentity: vi.fn(async () => ({ key: 'test' })),
  checkRateLimitDurable: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('@/lib/alpaca', () => ({ submitOrder: vi.fn(), AlpacaError: class extends Error {} }));
vi.mock('@/lib/live-order-safety', () => ({ assertLiveOrderAllowed: vi.fn(), formatLiveOrderRejection: vi.fn(), resolveNotionalUsd: vi.fn() }));
vi.mock('@/lib/trading-mode', () => ({ LiveOrderRejectedError: class extends Error {} }));
vi.mock('@/lib/keisha/pending-orders', () => ({ consumePendingOrder: vi.fn() }));
vi.mock('@/lib/api-error', () => ({ captureRouteError: vi.fn() }));
vi.mock('@/lib/request-id', () => ({ loggerFor: vi.fn(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, request_id: 'r' })) }));

import { addWatchlist } from '@/lib/keisha/tools/add-watchlist';
import { POST } from '@/app/api/keisha/actions/route';

async function postAdd(symbol: string) {
  const req = { json: async () => ({ action: 'add_watchlist', params: { symbol } }) } as unknown as NextRequest;
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as { success?: boolean; message?: string; error?: string } };
}

beforeEach(() => {
  h.state.rows = [];
  h.state.hideLookup = false;
  h.state.lookupError = null;
  h.state.insertError = null;
  h.state.inserts = 0;
});

describe('Keisha add_watchlist tool', () => {
  it('adds a new symbol', async () => {
    const r = await addWatchlist.execute({ symbol: 'NVDA' });
    expect(r.success).toBe(true);
    expect(h.state.rows).toEqual([{ symbol: 'NVDA' }]);
  });

  it('says a watched symbol is already there without inserting', async () => {
    h.state.rows.push({ symbol: 'NVDA' });
    const r = await addWatchlist.execute({ symbol: 'NVDA' });
    expect(r).toMatchObject({ success: true, result: { message: 'NVDA is already on your watchlist' } });
    expect(h.state.inserts).toBe(0);
  });

  it('treats a duplicate on insert (row added since the lookup) as already watched', async () => {
    h.state.rows.push({ symbol: 'NVDA' });
    h.state.hideLookup = true;
    const r = await addWatchlist.execute({ symbol: 'NVDA' });
    expect(r).toMatchObject({ success: true, result: { message: 'NVDA is already on your watchlist' } });
    expect(JSON.stringify(r)).not.toMatch(/duplicate key/);
  });

  it('treats a duplicate on insert after a failed lookup as already watched', async () => {
    h.state.rows.push({ symbol: 'NVDA' });
    h.state.lookupError = { message: 'connection reset' };
    const r = await addWatchlist.execute({ symbol: 'NVDA' });
    expect(r).toMatchObject({ success: true, result: { message: 'NVDA is already on your watchlist' } });
  });

  it('still reports any other insert error', async () => {
    h.state.insertError = { code: '42501', message: 'permission denied for table watchlist' };
    const r = await addWatchlist.execute({ symbol: 'AAPL' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/permission denied/);
  });
});

describe('POST /api/keisha/actions add_watchlist', () => {
  it('adds a new symbol', async () => {
    const r = await postAdd('NVDA');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('answers 200 "already on your watchlist" for a duplicate on insert, not a 500', async () => {
    h.state.rows.push({ symbol: 'NVDA' });
    h.state.hideLookup = true;
    const r = await postAdd('NVDA');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, message: 'NVDA is already on your watchlist' });
  });

  it('still answers 500 for any other insert error', async () => {
    h.state.insertError = { code: '42501', message: 'permission denied for table watchlist' };
    const r = await postAdd('AAPL');
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/permission denied/);
  });
});
