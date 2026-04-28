import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F8 — Polymarket + Kalshi event-odds overlay.
 *
 * The route /api/prediction-markets exposes the most recent snapshot per
 * tracked ticker, computed daily by the existing cron
 * (/api/cron/prediction-snapshot) and persisted to
 * prediction_market_snapshots.
 *
 * Degrades gracefully when the snapshots table is empty or when the cron
 * has never run — empty markets array, 200 OK.
 */
test.describe('@smoke F8 — prediction markets overlay', () => {
  test('GET returns well-formed payload', async ({ request }) => {
    const res = await request.get('/api/prediction-markets');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.source).toContain('polymarket');
    expect(Array.isArray(body.markets)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.count).toBe('number');

    if (body.markets.length > 0) {
      const m = body.markets[0];
      expect(['polymarket', 'kalshi']).toContain(m.source);
      expect(m.ticker).toBeTruthy();
      expect(m.name).toBeTruthy();
      // yesPrice is 0-1 OR null (some markets have no bid/ask yet)
      if (m.yesPrice !== null) {
        expect(typeof m.yesPrice).toBe('number');
        expect(m.yesPrice).toBeGreaterThanOrEqual(0);
        expect(m.yesPrice).toBeLessThanOrEqual(1);
      }
    }
  });
});
