import { test, expect } from '@playwright/test';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ageMs(timestamp: unknown): number {
  expect(typeof timestamp).toBe('string');
  const parsed = Date.parse(timestamp as string);
  expect(Number.isFinite(parsed)).toBe(true);
  return Date.now() - parsed;
}

function isWeekdayInNewYork(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

test.describe('@freshness live-data freshness', () => {
  test('GET /api/health has a timestamp from the last 10 minutes', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    const age = ageMs(body.timestamp);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(TEN_MINUTES_MS);
  });

  test('GET /api/narrative is fresh on New York weekdays', async ({ request }) => {
    const res = await request.get('/api/narrative');
    expect(res.status()).toBe(200);

    const body = await res.json();
    const age = ageMs(body.timestamp);
    expect(age).toBeGreaterThanOrEqual(0);
    if (isWeekdayInNewYork()) {
      expect(age).toBeLessThan(ONE_DAY_MS);
    }
  });

  test('dashboard morning briefing endpoint responds successfully', async ({ request }) => {
    // MorningBriefing.tsx reads this endpoint; an empty/weekend briefing is
    // valid, but the endpoint itself must remain available.
    const res = await request.get('/api/briefing/today');
    expect(res.status()).toBe(200);
  });
});
