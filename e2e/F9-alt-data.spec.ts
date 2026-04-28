import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F9 — trade & shipping alt-data overlay.
 *
 * Route /api/alt-data returns FRED trade/freight/fuel indicators with
 * period-over-period changes. Sourced from FRED (free tier, ~120 req/min)
 * and cached 1h. Degrades to empty arrays + 500 if FRED is unreachable
 * or the FRED_API_KEY env var is missing.
 */
test.describe('@smoke F9 — trade & shipping alt-data', () => {
  test('returns configured series with latest observation', async ({ request }) => {
    const res = await request.get('/api/alt-data');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('fred');
    expect(Array.isArray(body.series)).toBe(true);
    expect(body.series.length).toBeGreaterThanOrEqual(5);

    for (const s of body.series) {
      expect(s.seriesId).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.units).toBeTruthy();
      expect(Array.isArray(s.observations)).toBe(true);
      if (s.latest) {
        expect(s.latest.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }

    expect(body.summary).toBeDefined();
    expect(typeof body.summary.count).toBe('number');
  });
});
