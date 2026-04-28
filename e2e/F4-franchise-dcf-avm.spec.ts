import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F4 — franchise DCF + property AVM.
 *
 * Two separate routes:
 *   /api/wealth/franchise-dcf   pure-function 5-year DCF over 23 CR3
 *                               territories with overridable assumptions
 *   /api/wealth/property-avm    ATTOM AVM lookup with graceful
 *                               wealth_assets fallback
 */
test.describe('@smoke F4 — franchise DCF + property AVM', () => {
  test('franchise-dcf returns full projection with EV', async ({ request }) => {
    const res = await request.get('/api/wealth/franchise-dcf');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inputs).toBeDefined();
    expect(body.inputs.territories).toBe(23);
    expect(typeof body.yearOneRevenue).toBe('number');
    expect(body.yearOneRevenue).toBeGreaterThan(1_000_000); // $1M+ at baseline
    expect(Array.isArray(body.projection)).toBe(true);
    expect(body.projection.length).toBe(5);
    for (const yr of body.projection) {
      expect(yr.year).toBeGreaterThanOrEqual(1);
      expect(yr.revenue).toBeGreaterThan(0);
      expect(yr.ebitda).toBeGreaterThan(0);
      expect(yr.presentValue).toBeGreaterThan(0);
    }
    expect(body.enterpriseValue).toBeGreaterThan(body.yearOneRevenue);
    expect(body.comparableValueRange.low).toBeLessThan(body.comparableValueRange.high);
  });

  test('franchise-dcf respects override params', async ({ request }) => {
    const res = await request.get('/api/wealth/franchise-dcf?territories=10&avgRevenue=50000');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inputs.territories).toBe(10);
    expect(body.inputs.avgRevenuePerTerritoryUSD).toBe(50_000);
  });

  test('property-avm returns a usable shape (with or without ATTOM)', async ({ request }) => {
    const res = await request.get('/api/wealth/property-avm');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['attom', 'wealth_assets', 'unconfigured']).toContain(body.source);
    expect(body.address).toBeTruthy();
    expect(typeof body.notes).toBe('string');
    // estimatedValue may be null only if both ATTOM AND wealth_assets are
    // unavailable. Wes's account has a Miami Shores row in wealth_assets so
    // the fallback should produce a number.
    expect(body.estimatedValue).not.toBeNull();
    expect(body.estimatedValue).toBeGreaterThan(0);
  });
});
