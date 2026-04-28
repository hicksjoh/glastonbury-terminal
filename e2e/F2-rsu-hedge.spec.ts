import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F2 — RSU concentration hedge agent.
 *
 * GET /api/hedge/rsu returns cached analysis or, on first hit, the wealth
 * snapshot with a hint to POST. POST runs the actual Claude agent-team
 * analysis (rate-limited 5/min).
 *
 * We DO NOT exercise the POST path in CI because it burns Claude tokens
 * every run. Instead we verify GET shape + that wealth_assets data
 * flows through correctly.
 */
test.describe('@smoke F2 — RSU hedge agent', () => {
  test('GET returns wealth snapshot when no cached analysis', async ({ request }) => {
    const res = await request.get('/api/hedge/rsu');
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Either a cached analysis exists, or we get the wealth-snapshot empty
    // state. Both are acceptable shapes.
    if (body.analysis) {
      expect(body.analysis.concentration).toBeDefined();
      expect(body.analysis.bullCase).toBeDefined();
      expect(body.analysis.bearCase).toBeDefined();
      expect(body.analysis.synthesis).toBeDefined();
    } else {
      expect(body.wealth).toBeDefined();
      expect(typeof body.wealth.rsu).toBe('number');
      expect(typeof body.wealth.total).toBe('number');
      // Wes's actual RSU position is ~$1.49M; never expect 0 in the
      // populated dataset. If it IS 0, wealth_assets needs seeding.
      expect(body.wealth.rsu).toBeGreaterThan(0);
      expect(body.wealth.total).toBeGreaterThan(body.wealth.rsu);
    }
  });
});
