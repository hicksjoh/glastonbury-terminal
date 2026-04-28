import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F11 — Debate-agent trade approval gate.
 *
 * Orders below $5K notional skip the debate. Orders at-or-above the
 * threshold trigger a Haiku debate-gate call that returns approve /
 * caution / reject. We verify the threshold logic via the preview
 * path so CI doesn't burn Claude tokens on the live debate path.
 */
test.describe('@smoke F11 — debate gate', () => {
  test('small order (< $5K notional) does not trigger the debate', async ({ request }) => {
    const res = await request.post('/api/alpaca/orders', {
      data: { symbol: 'AAPL', side: 'buy', qty: 1, limit_price: 250, mode: 'preview' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    // Notional = 1 * 250 = $250 < $5K, debate must be null.
    expect(body.debate).toBeNull();
  });

  test('large order (>= $5K) triggers the debate', async ({ request }) => {
    const res = await request.post('/api/alpaca/orders', {
      data: { symbol: 'AAPL', side: 'buy', qty: 50, limit_price: 250, mode: 'preview' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.debate).not.toBeNull();
    expect(['approve', 'caution', 'reject']).toContain(body.debate.verdict);
    expect(body.debate.triggered).toBe(true);
    expect(body.debate.notional).toBeGreaterThanOrEqual(5_000);
    expect(typeof body.debate.rationale).toBe('string');
  });
});
