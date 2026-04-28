import { test, expect } from '@playwright/test';

/**
 * Acceptance test for F6 — 13F whale mirror via SEC EDGAR.
 *
 * /api/whales returns a roster of tracked superinvestors with their most
 * recent 13F-HR filing metadata. /api/whales?slug=xxx drills into holdings,
 * and ?slug=xxx&diff=true computes period-over-period changes.
 *
 * The underlying data comes from data.sec.gov (free, no API key required
 * but a contact email is sent in User-Agent per SEC fair-access policy).
 */
test.describe('@smoke F6 — 13F whale mirror', () => {
  test('roster endpoint returns at least 8 whales each with a latest filing', async ({ request }) => {
    const res = await request.get('/api/whales');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('sec-edgar');
    expect(Array.isArray(body.whales)).toBe(true);
    expect(body.whales.length).toBeGreaterThanOrEqual(8);

    for (const w of body.whales) {
      expect(w.slug).toBeTruthy();
      expect(w.name).toBeTruthy();
      expect(w.cik).toMatch(/^\d{10}$/);
      // Every tracked whale must have at least one 13F-HR filing on record.
      expect(w.latestFiling).not.toBeNull();
      expect(w.latestFiling.accessionNumber).toBeTruthy();
      expect(w.latestFiling.filingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The info-table filename is not standardized across filings, so we
      // return the filing's index.json sentinel and resolve lazily at fetch.
      expect(w.latestFiling.infoTableUrl).toMatch(/\/index\.json$/);
    }
  });

  test('detail endpoint (Berkshire) returns top holdings', async ({ request }) => {
    const res = await request.get('/api/whales?slug=berkshire');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.whale.slug).toBe('berkshire');
    expect(Array.isArray(body.topHoldings)).toBe(true);
    // Berkshire typically has ~40 positions; we return top 25 by value.
    expect(body.topHoldings.length).toBeGreaterThan(5);
    const first = body.topHoldings[0];
    expect(first.nameOfIssuer).toBeTruthy();
    expect(first.cusip).toBeTruthy();
    expect(first.valueUsd).toBeGreaterThan(0);
    // Top Berkshire holding should be worth billions.
    expect(first.valueUsd).toBeGreaterThan(1_000_000_000);
  });

  test('unknown slug returns 404', async ({ request }) => {
    const res = await request.get('/api/whales?slug=does-not-exist');
    expect(res.status()).toBe(404);
  });
});
