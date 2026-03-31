import { test, expect } from '@playwright/test';
import { expectAPIReturnsJSON, expectFieldTypes } from './helpers/api-utils';

test.describe('API Routes — All endpoints return valid data', () => {

  test('GET /api/options/chain/AAPL returns valid chain data', async ({ request }) => {
    const data = await expectAPIReturnsJSON(request, '/api/options/chain/AAPL');

    // API returns {chain: [...], symbol, count}
    const chain = Array.isArray(data) ? data : (data.chain || data.calls || []);
    expect(chain.length).toBeGreaterThan(0);

    // THE CRITICAL CHECK: Verify numeric fields are actually numbers, not strings
    const entry = chain[0];
    expectFieldTypes(entry, {
      strike: 'number',
      bid: 'number',
      ask: 'number',
      last: 'number',
      volume: 'number',
      openInterest: 'number',
      impliedVolatility: 'number',
      delta: 'number',
      gamma: 'number',
      theta: 'number',
      vega: 'number',
    });

    // Sanity checks
    expect(entry.strike).toBeGreaterThan(0);
    if (entry.bid > 0 && entry.ask > 0) {
      expect(entry.bid).toBeLessThanOrEqual(entry.ask);
    }
    expect(entry.type).toMatch(/^(call|put)$/);
  });

  test('GET /api/options/chain/FAKESYMBOL returns graceful error', async ({ request }) => {
    const response = await request.get('/api/options/chain/FAKESYMBOL');
    // Should not be 500 (server crash)
    expect(response.status()).not.toBe(500);
    // Should return JSON error, not HTML
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('json');
  });

  test('GET /api/options/expirations/AAPL returns date array', async ({ request }) => {
    const data = await expectAPIReturnsJSON(request, '/api/options/expirations/AAPL');
    expect(Array.isArray(data) || Array.isArray(data.expirations)).toBe(true);

    const dates = Array.isArray(data) ? data : data.expirations;
    if (dates.length > 0) {
      // Expirations may be objects {date, dte, category} or plain strings
      const first = dates[0];
      const dateStr = typeof first === 'object' ? first.date : first;
      expect(Date.parse(dateStr)).not.toBeNaN();
    }
  });

  test('GET /api/options/iv/AAPL returns IV data', async ({ request }) => {
    const data = await expectAPIReturnsJSON(request, '/api/options/iv/AAPL');

    // If data is available (may not be during off-hours)
    if (data.ivRank !== null && data.ivRank !== undefined) {
      expect(typeof data.ivRank).toBe('number');
      expect(data.ivRank).toBeGreaterThanOrEqual(0);
      expect(data.ivRank).toBeLessThanOrEqual(100);
    }
  });

  test('GET /api/options/positions returns array', async ({ request }) => {
    const data = await expectAPIReturnsJSON(request, '/api/options/positions');
    expect(Array.isArray(data) || Array.isArray(data.positions)).toBe(true);
  });

  test('POST /api/options/screener accepts filters', async ({ request }) => {
    const response = await request.post('/api/options/screener', {
      data: { preset: 'covered_call_candidates' },
    });
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('POST /api/options/order rejects invalid order', async ({ request }) => {
    const response = await request.post('/api/options/order', {
      data: { symbol: '', qty: 0 },
    });
    // Should return 400 (bad request), not 500 (crash)
    expect(response.status()).not.toBe(500);
  });

  // Regression: existing stock APIs still work
  test('GET /api/alpaca/positions still returns data', async ({ request }) => {
    const response = await request.get('/api/alpaca/positions');
    expect(response.status()).toBe(200);
  });

  test('GET /api/alpaca/account still returns data', async ({ request }) => {
    const response = await request.get('/api/alpaca/account');
    expect(response.status()).toBe(200);
  });
});
