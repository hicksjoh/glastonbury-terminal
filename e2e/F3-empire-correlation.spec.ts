import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F3 — Empire ⇄ Markets correlation.
 *
 * Aggregates CR3 territory footprint + current market regime +
 * recent regime history + storm exposure + wealth snapshot into
 * one payload. Surfaces a qualitative correlation note keyed off
 * the current VIX bucket so consumers don't have to re-reason
 * every render.
 */
test.describe('@smoke F3 — empire correlation', () => {
  test('returns territory rollup + regime + wealth + storm exposure', async ({ request }) => {
    const res = await request.get('/api/empire-correlation');
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.territoryFootprint).toBeDefined();
    expect(typeof body.territoryFootprint.total).toBe('number');
    expect(body.territoryFootprint.total).toBeGreaterThan(0);
    expect(body.territoryFootprint.byRegion).toBeDefined();
    expect(body.territoryFootprint.byArType).toBeDefined();

    expect(body.regime).toBeDefined();
    expect(Array.isArray(body.regime.recent)).toBe(true);

    expect(body.stormExposure).toBeDefined();
    expect(typeof body.stormExposure.exposurePct).toBe('number');
    expect(Array.isArray(body.stormExposure.recentAlerts)).toBe(true);

    expect(body.wealth).toBeDefined();
    expect(body.wealth.rsu).toBeGreaterThan(0);
    expect(body.wealth.franchise).toBeGreaterThan(0);

    expect(typeof body.correlationNote).toBe('string');
    expect(body.generatedAt).toBeTruthy();
  });
});
