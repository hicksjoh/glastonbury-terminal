import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Truth invariants — the nightly prod run asserts that the numbers and the
 * automations are TRUE, not merely that pages answer 200.
 *
 * Two production QA sweeps (2026-09-14, 2026-10-05) found dozens of defects
 * while CI and the nightly smoke were green, because the smoke only checked
 * "200 and renders". Every test below pins something that was actually broken
 * in production.
 *
 * Rules for this file:
 *   - Assert RELATIONSHIPS, never "data is non-empty": markets close, weekends
 *     happen, third-party feeds go quiet. None of that may redden this suite.
 *   - Unknown shape fails closed. A missing field, an unexpected type or an
 *     unrecognised enum value is a failure, never a skipped branch.
 *   - Read-only. No POSTs, and never GET /api/briefing (it bills an LLM call).
 */

const KNOWN_REGIMES = ['bull_low_vol', 'bull_high_vol', 'bear_low_vol', 'bear_high_vol'] as const;
const SCANNER_PRESETS = ['confluence', 'momentum', 'value', 'income'] as const;
const SCANNER_SOURCES = ['top_gainer', 'most_active', 'insider_buy', 'value_screen', 'dividend_income'];

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** GET a route that must answer 200 with a JSON object. */
async function getJson(request: APIRequestContext, url: string): Promise<Json> {
  const res = await request.get(url);
  expect(res.status(), `${url} status`).toBe(200);
  const body: unknown = await res.json();
  expect(isObject(body), `${url} must return a JSON object`).toBe(true);
  return body as Json;
}

function finiteNumber(v: unknown, label: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${label} must be a finite number, got ${JSON.stringify(v)}`).toBe(true);
  return v as number;
}

test.describe('@smoke @truth truth invariants', () => {
  test('regime is a known value on success and "unknown" on failure, never a default', async ({ request }) => {
    const body = await getJson(request, '/api/regime');
    expect(typeof body.success, 'success must be a boolean').toBe('boolean');
    expect(isObject(body.data), 'data must be an object').toBe(true);
    const regime = (body.data as Json).regime;
    if (body.success === true) {
      expect(KNOWN_REGIMES as readonly unknown[], `success:true with regime ${JSON.stringify(regime)}`).toContain(regime);
    } else {
      expect(regime, 'success:false must report regime "unknown"').toBe('unknown');
    }
  });

  test('internal self-calls work: scanner marketRegime matches /api/regime', async ({ request }) => {
    // The scanner gets its regime by calling /api/regime server-to-server.
    // Those self-calls 401'd in production, so the scanner silently ran on
    // "unknown" while the header chip showed a real regime.
    //
    // /api/regime is asked first so its 1h cache is warm when the scanner
    // makes its own call. The pair is re-read once on a mismatch, which is the
    // only way the two can legitimately differ (the cache rolling over
    // between the two requests).
    let last = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const regimeBody = await getJson(request, '/api/regime');
      const scanner = await getJson(request, '/api/scanner');
      expect(typeof scanner.marketRegime, 'scanner.marketRegime must be a string').toBe('string');
      if (regimeBody.success !== true) {
        // Nothing to compare against; the regime test above covers this shape.
        test.info().annotations.push({
          type: 'regime-unavailable',
          description: '/api/regime returned success:false, so the scanner comparison was not applicable this run',
        });
        return;
      }
      const expected = (regimeBody.data as Json | undefined)?.regime;
      if (scanner.marketRegime === expected) return;
      last = `scanner.marketRegime=${JSON.stringify(scanner.marketRegime)} but /api/regime data.regime=${JSON.stringify(expected)}`;
    }
    throw new Error(`internal self-call is not reaching /api/regime (checked twice): ${last}`);
  });

  for (const preset of SCANNER_PRESETS) {
    test(`scanner honesty (${preset}): no invented sizing, only real evidence sources`, async ({ request }) => {
      const body = await getJson(request, `/api/scanner?preset=${preset}`);
      expect(body.preset, 'scanner must echo the requested preset').toBe(preset);
      expect(Array.isArray(body.signals), 'signals must be an array (empty is fine)').toBe(true);
      for (const raw of body.signals as unknown[]) {
        expect(isObject(raw), 'every signal must be an object').toBe(true);
        const signal = raw as Json;
        const label = `${preset} signal ${JSON.stringify(signal.symbol)}`;
        // toBe(null) on purpose: an absent key (undefined) is an unknown shape.
        expect(signal.kellySizing, `${label}: kellySizing`).toBe(null);
        expect(Array.isArray(signal.sources), `${label}: sources must be an array`).toBe(true);
        const sources = signal.sources as unknown[];
        expect(sources.length, `${label}: a signal with no evidence source`).toBeGreaterThan(0);
        for (const source of sources) {
          expect(SCANNER_SOURCES, `${label}: unrecognised source ${JSON.stringify(source)}`).toContain(source);
        }
      }
    });
  }

  test('wealth arithmetic: net worth is the sum of its real parts, simulated equity excluded', async ({ request }) => {
    const body = await getJson(request, '/api/wealth');
    expect(body.success, '/api/wealth success').toBe(true);
    expect(isObject(body.data), 'data must be an object').toBe(true);
    const data = body.data as Json;
    expect(isObject(data.breakdown), 'breakdown must be an object').toBe(true);
    const breakdown = data.breakdown as Json;

    // The rule in src/app/api/wealth/route.ts: total = investments + franchise
    // + real_estate + rsus + cash − (liabilities ?? 0). An unexpected extra
    // breakdown key means that rule changed and this test must change with it.
    const COUNTED = ['investments', 'franchise', 'real_estate', 'rsus', 'cash'];
    expect(Object.keys(breakdown).sort(), 'breakdown keys').toEqual([...COUNTED].sort());
    let sum = 0;
    for (const key of COUNTED) {
      expect(isObject(breakdown[key]), `breakdown.${key} must be an object`).toBe(true);
      sum += finiteNumber((breakdown[key] as Json).value, `breakdown.${key}.value`);
    }
    expect(data.liabilities === null || (typeof data.liabilities === 'number' && Number.isFinite(data.liabilities)),
      `liabilities must be null or a finite number, got ${JSON.stringify(data.liabilities)}`).toBe(true);
    const liabilities = typeof data.liabilities === 'number' ? data.liabilities : 0;

    const total = finiteNumber(data.total_net_worth, 'total_net_worth');
    expect(Math.abs(total - (sum - liabilities)), `total_net_worth ${total} vs sum of parts ${sum} − liabilities ${liabilities}`)
      .toBeLessThanOrEqual(1);

    // Paper equity is simulated money. It was once summed into net worth,
    // inflating the headline by Alpaca's $100k paper seed.
    const investments = breakdown.investments as Json;
    const simulatedExcluded = finiteNumber(data.simulated_equity_excluded, 'simulated_equity_excluded');
    expect(simulatedExcluded).toBeGreaterThanOrEqual(0);
    expect(typeof investments.simulated, 'breakdown.investments.simulated must be a boolean').toBe('boolean');
    expect(typeof data.trading_mode, 'trading_mode must be a string').toBe('string');
    if (data.trading_mode !== 'live') {
      expect(investments.simulated, 'a non-live account must be flagged simulated').toBe(true);
    }
    if (investments.simulated === true) {
      expect(investments.value, 'simulated equity must contribute 0 to net worth').toBe(0);
    } else {
      expect(simulatedExcluded, 'real equity cannot also be reported as excluded').toBe(0);
    }
  });

  test('cron dead-man: every scheduled job has left recent evidence', async ({ request }) => {
    const body = await getJson(request, '/api/ops/cron-freshness');
    expect(typeof body.ok, 'ok must be a boolean').toBe('boolean');
    expect(Array.isArray(body.crons), 'crons must be an array').toBe(true);
    const crons = body.crons as unknown[];
    expect(crons.length, 'the check reported no crons at all').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const raw of crons) {
      if (!isObject(raw)) {
        offenders.push(`malformed row ${JSON.stringify(raw)}`);
        continue;
      }
      // `awaiting_first_run` is the one-time arming window (see
      // DEAD_MAN_ARMED_AT in src/lib/cron-freshness.ts); it expires on its own.
      if (raw.status !== 'fresh' && raw.status !== 'awaiting_first_run') {
        offenders.push(
          `${String(raw.name)} [${String(raw.path)} @ ${String(raw.schedule)}] is ${String(raw.status)}` +
          ` (last evidence: ${raw.lastEvidenceAt === null ? 'none' : String(raw.lastEvidenceAt)}, max age ${String(raw.maxAgeHours)}h` +
          `${typeof raw.detail === 'string' ? `; ${raw.detail}` : ''})`,
        );
      }
    }
    expect(offenders, `scheduled jobs not provably running:\n  ${offenders.join('\n  ')}\n`).toEqual([]);
    // Belt and braces: the route's own verdict must agree with its rows.
    expect(body.ok, 'every row is healthy but the route says ok:false').toBe(true);
  });

  test('no synthetic data: strategy benchmark returns an empty series with a reason', async ({ request }) => {
    // This route used to invent an "alpha" series from SPY plus seeded noise.
    const body = await getJson(request, '/api/strategies/benchmark?strategy=covered_call_wheel');
    expect(body.data, 'benchmark data must be an empty array until trades are attributed').toEqual([]);
    expect(typeof body.reason === 'string' && body.reason.length > 0, 'an empty series must say why').toBe(true);
  });

  test('no synthetic data: a modelled vol surface reports no mispricings', async ({ request }) => {
    const res = await request.get('/api/vol-surface?symbol=AAPL');
    // 502 = the quote provider had nothing for us; not this suite's concern.
    expect([200, 502], `/api/vol-surface status ${res.status()}`).toContain(res.status());
    if (res.status() === 502) {
      test.info().annotations.push({ type: 'upstream-unavailable', description: '/api/vol-surface answered 502 (quote provider); invariant not exercised this run' });
      return;
    }
    const body: unknown = await res.json();
    expect(isObject(body), 'vol-surface must return a JSON object').toBe(true);
    const surface = body as Json;
    expect(typeof surface.modelled, 'modelled must be a boolean so the page can label the surface').toBe('boolean');
    expect(Array.isArray(surface.mispricings), 'mispricings must be an array').toBe(true);
    if (surface.modelled === true) {
      // A "mispricing" measured against a surface we generated ourselves is fiction.
      expect(surface.mispricings, 'a modelled surface cannot have mispricings').toEqual([]);
    }
  });

  test('storm status: coverage figures add up against the expected footprint', async ({ request }) => {
    const body = await getJson(request, '/api/storm/status');
    expect(isObject(body.coverage), 'coverage must be an object').toBe(true);
    const coverage = body.coverage as Json;

    const expected = finiteNumber(coverage.expected, 'coverage.expected');
    const monitored = finiteNumber(coverage.monitored, 'coverage.monitored');
    const notConfigured = finiteNumber(coverage.notConfigured, 'coverage.notConfigured');
    expect(Array.isArray(coverage.missingZips), 'coverage.missingZips must be an array').toBe(true);
    const missingZips = (coverage.missingZips as unknown[]).length;
    expect(typeof coverage.complete, 'coverage.complete must be a boolean').toBe('boolean');

    for (const [label, n] of [['expected', expected], ['monitored', monitored], ['notConfigured', notConfigured]] as const) {
      expect(Number.isInteger(n) && n >= 0, `coverage.${label} must be a non-negative integer, got ${n}`).toBe(true);
    }
    expect(expected, 'coverage.expected').toBeGreaterThan(0);

    // Every expected territory is exactly one of: monitored, row-without-ZIPs,
    // or no row. The card once said "All clear" while covering 10 of 23.
    const accounted = monitored + missingZips + notConfigured;
    expect(accounted, `monitored ${monitored} + missingZips ${missingZips} + notConfigured ${notConfigured} must account for all ${expected} expected`)
      .toBeGreaterThanOrEqual(expected);
    if (notConfigured > 0) {
      expect(accounted, 'with unconfigured territories the three buckets must sum to exactly expected').toBe(expected);
    }
    expect(coverage.complete, 'complete must mean monitored >= expected').toBe(monitored >= expected);

    if (coverage.complete === false) {
      // Known, tracked gap — reported, not failed.
      test.info().annotations.push({
        type: 'known-gap',
        description: `storm coverage incomplete: ${monitored}/${expected} territories monitored, ${missingZips} without ZIPs, ${notConfigured} not configured`,
      });
    }
  });
});
