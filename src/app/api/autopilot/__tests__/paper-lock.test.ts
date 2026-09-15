import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
//  Autopilot trading-mode lock
//
//  Originally the "paper-lock" suite (S2, Codex round-2 review 2026-04-28).
//  Kept the same file name for git-log continuity when live trading unlocked.
//
//  Invariants the autopilot cron MUST preserve:
//    (1) Paper mode + non-paper URL → refuse (mode/URL drift)
//    (2) Live mode + AUTOPILOT_ALLOW_LIVE unset → refuse (explicit opt-in)
//    (3) Live mode + AUTOPILOT_ALLOW_LIVE=true + live URL, but NO session
//        x-live-ack → still refuse. The env flag is a precondition, not an
//        authorization. (This case previously asserted the opposite: that the
//        env flag alone was sufficient to fire a live market order. That was
//        the bug, written down as the spec.)
//    (4) Live mode + AUTOPILOT_ALLOW_LIVE=true + paper URL → refuse
//    (5) The autopilot module still routes through the shared live-order gate
// ═══════════════════════════════════════════════════════════════════════════

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_SECRET_KEY = 'test-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function stubDeps() {
  vi.doMock('@/lib/supabase', () => ({
    createServiceClient: () => ({
      from: () => ({
        insert: () => Promise.resolve({ data: null, error: null }),
        select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
    }),
  }));
  vi.doMock('@/lib/rate-limit', () => ({
    rateLimit: () => ({ allowed: true }),
  }));
}

async function callExecute(symbol: string, shares: number, side: 'buy' | 'sell') {
  const { POST } = await import('../route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/autopilot', {
    method: 'POST',
    body: JSON.stringify({ action: 'execute', symbol, shares, side }),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(req);
}

describe('autopilot mode/URL drift protection', () => {
  it('paper mode + LIVE base URL: blocks and no /v2/orders POST is issued', async () => {
    delete process.env.TRADING_MODE;
    process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await callExecute('AAPL', 1, 'buy');
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('paper mode + spoofed host: blocks (host check is the gate, not network)', async () => {
    delete process.env.TRADING_MODE;
    process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets.evil.com';
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await callExecute('TSLA', 5, 'buy');
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('autopilot live-mode explicit opt-in', () => {
  it('live mode without AUTOPILOT_ALLOW_LIVE: refuses with autopilot_live_disabled code', async () => {
    process.env.TRADING_MODE = 'live';
    process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
    delete process.env.AUTOPILOT_ALLOW_LIVE;
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await callExecute('NVDA', 1, 'buy');
    const body = await res.json();

    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBe(403);
    expect(body).toEqual(expect.objectContaining({ code: 'autopilot_live_disabled' }));
  });

  it('live mode + AUTOPILOT_ALLOW_LIVE=true + paper URL: refuses on drift', async () => {
    process.env.TRADING_MODE = 'live';
    process.env.AUTOPILOT_ALLOW_LIVE = 'true';
    process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await callExecute('SPY', 10, 'buy');
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('live mode + AUTOPILOT_ALLOW_LIVE=true + live URL, but no x-live-ack: STILL refuses', async () => {
    // The env flag says "this deployment is permitted to autotrade". It does
    // not say "this particular request is authorized to move this much money".
    // Every other order path (alpaca/orders, options/order, multi-leg, Keisha
    // place_order) additionally requires a session-bound x-live-ack token and
    // typed notional confirmation; autopilot used to require neither, so with
    // both env flags set an authenticated POST of
    // {"action":"execute","shares":100000} was an unbounded live market order.
    process.env.TRADING_MODE = 'live';
    process.env.AUTOPILOT_ALLOW_LIVE = 'true';
    process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'test-order', status: 'accepted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await callExecute('SPY', 1, 'buy');
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('paper mode + paper URL: fires normally (the gate is a no-op off-live)', async () => {
    // The counterweight to the case above — proving the new gate did not just
    // break autopilot outright. Paper trading must still work end to end.
    process.env.TRADING_MODE = 'paper';
    process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
    stubDeps();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'test-order', status: 'accepted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await callExecute('SPY', 1, 'buy');
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(orderCalls[0][0])).toContain('paper-api.alpaca.markets');
    expect(res.status).toBeLessThan(400);
  });
});

describe('autopilot wiring guard', () => {
  it('autopilot module still imports the trading-mode guard from @/lib/alpaca', async () => {
    // Documenting the guard's presence — if a future refactor drops the
    // import, this test fails even before any network mock.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../route.ts'),
      'utf8',
    );
    expect(src).toMatch(/from\s+['"]@\/lib\/live-order-safety['"]/);
    // The full four-gate check, not just mode/URL alignment.
    expect(src).toMatch(/assertLiveOrderAllowed/);
  });
});
