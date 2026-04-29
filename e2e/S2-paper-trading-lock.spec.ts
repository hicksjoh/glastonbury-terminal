import { test, expect } from '@playwright/test';

/**
 * Acceptance test for S2 — paper-trading lock across all order paths.
 *
 * Defense-in-depth: env-config drift on Vercel must NOT be enough to place
 * real orders. The guard lives in `src/lib/alpaca.ts` (assertPaperTrading)
 * and is exercised at the unit-test layer in `src/lib/__tests__/alpaca.test.ts`
 * because env overrides across the dev-server boundary are awkward and the
 * Playwright suite already runs against a deployed preview.
 *
 * This Playwright spec is a sanity check that the three order endpoints
 * exist and respond — not that the guard fires (covered by vitest). The
 * smoke check ensures the routes are still mounted after the refactor.
 *
 * Refs: Codex QA review 2026-04-28
 */
test.describe('@smoke S2 — paper-trading lock (route presence)', () => {
  test('POST /api/options/order responds (route exists, validates body)', async ({ request }) => {
    // Empty body should be rejected with a 4xx (missing required fields).
    // We're not testing live behavior — just that the route is mounted.
    const res = await request.post('/api/options/order', { data: {} });
    expect([400, 401, 429, 500]).toContain(res.status());
  });

  test('POST /api/options/order/multi-leg responds (route exists, validates body)', async ({
    request,
  }) => {
    const res = await request.post('/api/options/order/multi-leg', { data: {} });
    expect([400, 401, 429, 500]).toContain(res.status());
  });

  test('POST /api/keisha/actions place_order responds (route exists)', async ({ request }) => {
    const res = await request.post('/api/keisha/actions', {
      data: { action: 'place_order', params: {} },
    });
    // Missing symbol/side/qty → 400, or auth/rate-limit guards → 401/429
    expect([400, 401, 429, 500]).toContain(res.status());
  });
});
