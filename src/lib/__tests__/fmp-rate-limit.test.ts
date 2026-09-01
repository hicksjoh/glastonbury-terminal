/**
 * FMP rate-limit handling.
 *
 * Found live on 2026-08-31: every /stable endpoint was returning
 * HTTP 429 "Limit Reach" because the account's daily quota was
 * exhausted. Three code defects turned a quota problem into a worse
 * quota problem AND a silently wrong dashboard:
 *
 *  1. fetchSectorSnapshot returned [] for BOTH "no data for that date"
 *     and "you are rate limited", so getSectorPerformance walked five
 *     calendar days back — five more API calls after the first one had
 *     already said the quota was blown.
 *  2. Empty results are deliberately not cached ("retry next call"), so
 *     under a 429 every single request re-hit FMP 5+ times, guaranteeing
 *     the limit stayed blown.
 *  3. /api/sectors then emitted every sector at "0.00" with HTTP 200 and
 *     no degraded marker, so the heatmap rendered a flat market as if it
 *     were real data on a day the market actually moved.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSectorPerformance,
  __resetFmpRateLimitForTests,
  isFmpRateLimited,
} from '../fmp-client';

const originalFetch = global.fetch;
const originalEnv = process.env.FMP_API_KEY;

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ 'Error Message': 'Limit Reach . Please upgrade your plan' }),
    { status: 429 },
  );
}

function sectorRows(): Response {
  return new Response(JSON.stringify([
    { date: '2026-08-31', sector: 'Technology', exchange: 'NASDAQ', averageChange: 1.25 },
    { date: '2026-08-31', sector: 'Technology', exchange: 'NYSE', averageChange: 0.75 },
    { date: '2026-08-31', sector: 'Energy', exchange: 'NYSE', averageChange: -0.5 },
  ]), { status: 200 });
}

beforeEach(() => {
  process.env.FMP_API_KEY = 'test-key';
  __resetFmpRateLimitForTests();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env.FMP_API_KEY;
  else process.env.FMP_API_KEY = originalEnv;
  __resetFmpRateLimitForTests();
  vi.useRealTimers();
});

describe('getSectorPerformance — quota exhaustion must not be amplified', () => {
  it('STOPS after the first 429 instead of walking five days back', () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(rateLimited());
    });

    return getSectorPerformance().then((rows) => {
      expect(rows).toEqual([]);
      // The old loop made 5 calls after being told the quota was blown.
      expect(calls).toBe(1);
    });
  });

  it('still walks back through EMPTY days (a holiday weekend is not a 429)', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      // Third attempt has data.
      return Promise.resolve(calls < 3 ? new Response('[]', { status: 200 }) : sectorRows());
    });

    const rows = await getSectorPerformance();
    expect(calls).toBe(3);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('latches rate-limited so later callers do not re-hit a blown quota', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(rateLimited());
    });

    expect(isFmpRateLimited()).toBe(false);
    await getSectorPerformance();
    expect(isFmpRateLimited()).toBe(true);

    // Second and third calls must not touch the network at all.
    await getSectorPerformance();
    await getSectorPerformance();
    expect(calls).toBe(1);
  });

  it('clears the latch once the cooldown expires', async () => {
    vi.useFakeTimers();
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(calls === 1 ? rateLimited() : sectorRows());
    });

    await getSectorPerformance();
    expect(isFmpRateLimited()).toBe(true);

    vi.advanceTimersByTime(16 * 60 * 1000); // past the cooldown
    expect(isFmpRateLimited()).toBe(false);

    const rows = await getSectorPerformance();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('aggregates across exchanges as the mean averageChange', async () => {
    global.fetch = vi.fn().mockResolvedValue(sectorRows());
    const rows = await getSectorPerformance();
    const tech = rows.find(r => r.sector === 'Technology');
    // mean(1.25, 0.75) = 1.00
    expect(tech?.changesPercentage).toBeCloseTo(1.0, 6);
    const energy = rows.find(r => r.sector === 'Energy');
    expect(energy?.changesPercentage).toBeCloseTo(-0.5, 6);
  });

  it('never emits a non-finite changesPercentage', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { date: 'x', sector: 'Technology', exchange: 'NASDAQ', averageChange: 'oops' },
      { date: 'x', sector: 'Energy', exchange: 'NYSE', averageChange: 2 },
    ]), { status: 200 }));
    const rows = await getSectorPerformance();
    for (const r of rows) expect(Number.isFinite(r.changesPercentage)).toBe(true);
  });
});
