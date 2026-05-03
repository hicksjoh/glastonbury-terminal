import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
//  S2 — Autopilot paper-trading lock (Codex round-2 review 2026-04-28)
//
//  Gap closed: src/app/api/autopilot/route.ts at the `execute` action POSTs
//  /v2/orders to ALPACA_BASE_URL but previously only checked the unrelated
//  ALPACA_PAPER env var. The two can drift — ALPACA_PAPER=true alongside
//  ALPACA_BASE_URL=https://api.alpaca.markets would still fire a real order.
//
//  This suite hammers two invariants:
//    (1) When ALPACA_BASE_URL points at a non-paper host, the autopilot's
//        execute path must NOT call fetch against /v2/orders, and must
//        return a 5xx response containing "Paper-trading lock engaged".
//    (2) The autopilot module imports assertPaperTrading from @/lib/alpaca,
//        documenting the wiring so a future refactor doesn't quietly remove
//        the guard.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  // ALPACA_PAPER is intentionally set to 'true' for these tests — we are
  // proving that even with the legacy ALPACA_PAPER guard satisfied, the
  // host-level lock still blocks a misconfigured ALPACA_BASE_URL.
  process.env.ALPACA_PAPER = 'true';
  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_SECRET_KEY = 'test-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('autopilot paper-trading lock', () => {
  it('blocks /v2/orders POST and returns "Paper-trading lock engaged" when ALPACA_BASE_URL is non-paper', async () => {
    // Drift scenario: paper flag still set but base URL pointed at live host.
    process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    // Stub Supabase service client so the route doesn't try to hit a real DB.
    vi.doMock('@/lib/supabase', () => ({
      createServiceClient: () => ({
        from: () => ({
          insert: () => Promise.resolve({ data: null, error: null }),
          select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
      }),
    }));

    // Stub rate limiter so it doesn't 429 us based on previous tests' state.
    vi.doMock('@/lib/rate-limit', () => ({
      rateLimit: () => ({ allowed: true }),
    }));

    const { POST } = await import('../route');
    const { NextRequest } = await import('next/server');

    const req = new NextRequest('http://localhost/api/autopilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'execute', symbol: 'AAPL', shares: 1, side: 'buy' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    // The lock must engage — no /v2/orders POST should have been issued.
    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);

    // Response is a 5xx with the lock message in the body.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(body)).toMatch(/Paper-trading lock engaged/i);
  });

  it('does NOT call /v2/orders even when fetch is otherwise reachable (host check is the gate, not network)', async () => {
    process.env.ALPACA_BASE_URL = 'https://paper-api.alpaca.markets.evil.com';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

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

    const { POST } = await import('../route');
    const { NextRequest } = await import('next/server');

    const req = new NextRequest('http://localhost/api/autopilot', {
      method: 'POST',
      body: JSON.stringify({ action: 'execute', symbol: 'TSLA', shares: 5, side: 'buy' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);

    const orderCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url;
      return /\/v2\/orders\b/.test(u);
    });
    expect(orderCalls).toHaveLength(0);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('autopilot module imports assertPaperTrading from @/lib/alpaca (wiring guard)', async () => {
    // If a future refactor accidentally drops the import, this test fails
    // even before any network mock — documenting the guard's presence.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../route.ts'),
      'utf8',
    );
    expect(src).toMatch(/from\s+['"]@\/lib\/alpaca['"]/);
    expect(src).toContain('assertPaperTrading');
  });
});
