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

    // At least one sector should be non-zero — if everything is 0.00 the
    // fallback kicked in and we are not actually reading FMP sector data.
    //
    // But all-zero is also the CORRECT answer when no session has traded yet:
    // on a weekend, and on a weekday before the 09:30 ET open. The nightly
    // smoke runs at 07:00 ET, so asserting non-zero unconditionally would fail
    // this every single weekday morning and train everyone to ignore the alarm.
    // Only demand movement once the session has actually been underway.
    const nonZero = body.sectors.filter((s: { changesPercentage: string | number }) => {
      const pct = typeof s.changesPercentage === 'number'
        ? s.changesPercentage
        : parseFloat(s.changesPercentage);
      return Math.abs(pct) > 0.0001;
    });

    const et = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const part = (t: Intl.DateTimeFormatPartTypes) => et.find(p => p.type === t)?.value ?? '';
    const isWeekend = part('weekday') === 'Sat' || part('weekday') === 'Sun';
    const etMinutes = parseInt(part('hour'), 10) * 60 + parseInt(part('minute'), 10);
    // 09:45 ET — 15 minutes past the open, so prints have definitely landed.
    // Caveat: NYSE holidays are not modelled, so a manual afternoon run on
    // Thanksgiving or Christmas will still fail here. The scheduled nightly
    // runs at 07:00 ET and always takes the skip branch, so the dead-man
    // switch is unaffected.
    const sessionUnderway = !isWeekend && etMinutes >= 9 * 60 + 45;

    if (sessionUnderway) {
      expect(nonZero.length).toBeGreaterThan(0);
    } else {
      console.log(`[D1] Outside a traded session (ET ${part('weekday')} ${part('hour')}:${part('minute')}) — skipping the non-zero movement check.`);
    }
  });
});
