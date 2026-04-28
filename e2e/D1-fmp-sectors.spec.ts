import { test, expect } from '@playwright/test';

/**
 * Acceptance test for D1 — FMP /stable migration.
 *
 * The old endpoint `/stable/sector-performance` started returning 404 when
 * FMP migrated sector data to `/stable/sector-performance-snapshot?date=`.
 * We now route every sector-performance call through `src/lib/fmp-client.ts`.
 *
 * These tests run against the local dev server or the deployed Terminal.
 * Set E2E_BASE_URL=http://localhost:3000 for local runs.
 */
test.describe('@smoke D1 — FMP sector performance', () => {
  test('GET /api/health reports fmp: ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.services).toBeDefined();
    expect(body.services.fmp).toBe('ok');
  });

  test('GET /api/sectors returns a non-empty sectors array with numeric changes', async ({ request }) => {
    const res = await request.get('/api/sectors');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.sectors).toBeDefined();
    expect(Array.isArray(body.sectors)).toBe(true);
    expect(body.sectors.length).toBeGreaterThan(0);

    // Every sector must have a name and a changesPercentage that parses to a finite number.
    for (const s of body.sectors) {
      expect(typeof s.sector).toBe('string');
      expect(s.sector.length).toBeGreaterThan(0);
      const pct = typeof s.changesPercentage === 'number'
        ? s.changesPercentage
        : parseFloat(s.changesPercentage);
      expect(Number.isFinite(pct)).toBe(true);
    }

    // At least one sector should be non-zero on any normal trading day.
    // If everything is 0.00, the fallback kicked in and we're not actually
    // reading FMP sector data — that's the regression this test guards against.
    const nonZero = body.sectors.filter((s: { changesPercentage: string | number }) => {
      const pct = typeof s.changesPercentage === 'number'
        ? s.changesPercentage
        : parseFloat(s.changesPercentage);
      return Math.abs(pct) > 0.0001;
    });
    expect(nonZero.length).toBeGreaterThan(0);
  });
});
