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
    expect(body.sectors).toBeDefined();
    expect(Array.isArray(body.sectors)).toBe(true);

    // HONESTY CHECK — runs at every hour, weekends included.
    //
    // /api/sectors used to emit all eight sectors at "0.00" whenever it
    // had no usable upstream data, with HTTP 200 and no marker. That is
    // indistinguishable from a genuinely flat market, so the heatmap
    // rendered fabricated data and this spec passed straight through a
    // real FMP quota outage. The route must now say so explicitly.
    if (body.degraded) {
      throw new Error(
        `/api/sectors is DEGRADED (reason: ${body.reason}). Upstream FMP data is unavailable — ` +
        `the sector heatmap has no real data to show. This is a genuine outage, not a test flake.`,
      );
    }
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

    // At least one sector should be non-zero once a session has actually
    // traded. All-zero is the CORRECT answer on a weekend and before the
    // 09:30 ET open, so only demand movement inside a session.
    //
    // NOTE: this gate means the assertion below never executes on the
    // 07:00 ET nightly run. That is why the degraded check above is
    // deliberately UNGATED — it is the part that catches a real outage,
    // and it must run at every hour.
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
    // Thanksgiving or Christmas will still fail here.
    const sessionUnderway = !isWeekend && etMinutes >= 9 * 60 + 45;

    if (sessionUnderway) {
      expect(nonZero.length).toBeGreaterThan(0);
    } else {
      console.log(`[D1] Outside a traded session (ET ${part('weekday')} ${part('hour')}:${part('minute')}) — skipping the non-zero movement check.`);
    }
  });
});
