import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F12 — wash-sale + PDT order guards.
 *
 * The guards run BEFORE submitOrder is called. `mode: 'preview'` returns
 * the verdict + reasons without actually submitting, so we can exercise
 * the guard logic safely without placing real (paper) trades.
 */
test.describe('@smoke F12 — order guards', () => {
  test('preview returns guard verdict shape', async ({ request }) => {
    const res = await request.post('/api/alpaca/orders', {
      data: { symbol: 'AAPL', side: 'buy', qty: 1, mode: 'preview' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.guards).toBeDefined();
    expect(['ok', 'caution', 'block']).toContain(body.guards.verdict);
    expect(Array.isArray(body.guards.reasons)).toBe(true);
    expect(body.guards.pdt).toBeDefined();
    expect(typeof body.guards.pdt.dayTradesInWindow).toBe('number');
    expect(typeof body.guards.pdt.equityUsd).toBe('number');
    expect(body.guards.washSale).toBeDefined();
    expect(typeof body.guards.washSale.isWashSale).toBe('boolean');
  });
});
