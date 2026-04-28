import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F5 — free options flow via Alpaca options snapshots.
 *
 * The previous implementation tried Polygon /v3/snapshot/options/* (403 on
 * current tier) then fell through to FMP /v3/stock_market/actives (retired).
 * Post-F5 the route scans a watchlist (or an override list of symbols)
 * using Alpaca's options contracts + snapshots endpoints and returns a
 * ranked list of unusual-activity candidates.
 *
 * We intentionally accept an empty `flows` array here — off-hours, on
 * paper accounts, or with tight thresholds there may be no contracts
 * above the volume/OI bar. What matters is that the route returns HTTP 200
 * with a well-formed summary and does NOT 403 / 500 anymore.
 */
test.describe('@smoke F5 — options flow', () => {
  test('/api/flow returns the expected shape', async ({ request }) => {
    const res = await request.get('/api/flow?symbols=SPY,NVDA&minPremium=10000&minVolOI=1');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.flows)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.totalFlows).toBe('number');
    expect(typeof body.summary.bullishPct).toBe('number');
    expect(typeof body.summary.bearishPct).toBe('number');
    expect(Array.isArray(body.summary.scannedSymbols)).toBe(true);
    expect(body.summary.scannedSymbols).toEqual(expect.arrayContaining(['SPY', 'NVDA']));

    // If flows are present they should have all the ranking fields.
    if (body.flows.length > 0) {
      const f = body.flows[0];
      expect(f.underlying).toBeTruthy();
      expect(f.contract).toBeTruthy();
      expect(typeof f.volume).toBe('number');
      expect(typeof f.openInterest).toBe('number');
      expect(typeof f.volOiRatio).toBe('number');
      expect(typeof f.premiumUSD).toBe('number');
      expect(['call', 'put']).toContain(f.type);
      expect(['bullish', 'bearish']).toContain(f.direction);
      expect(['sweep', 'block', 'unusual']).toContain(f.flowType);
    }

    expect(body._meta).toBeDefined();
    expect(body._meta.source).toBe('alpaca-options');
  });

  test('/api/flow uses watchlist by default when no symbols param is given', async ({ request }) => {
    const res = await request.get('/api/flow?minPremium=1000000&minVolOI=5');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.summary).toBeDefined();
    expect(Array.isArray(body.summary.scannedSymbols)).toBe(true);
    expect(body.summary.scannedSymbols.length).toBeGreaterThan(0);
  });
});
