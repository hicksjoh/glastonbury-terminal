import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * S3 round-3 — idempotency on the four remaining cron routes:
 *   - tax-harvest         (persistSuggestions + Resend email)
 *   - coach-review        (persistCoachReview + Resend email)
 *   - prediction-snapshot (takePredictionSnapshot DB writes)
 *   - storm-watch         (persistAlertCandidates)
 *
 * Codex + Gemini round-3 review flagged these four as P0: a Vercel
 * retry would double-fire side effects. weekly-report already used
 * `tryClaimCronRun` + `markCronRunComplete`; this suite asserts the
 * same pattern landed on the other four.
 *
 * Strategy: mock `@/lib/cron-idempotency` so the first call returns
 * true (claim acquired) and the second call returns false (already
 * ran). Mock the engine + email + healthcheck modules so we can
 * count their invocations and assert the second call short-circuits.
 */

// Engine mocks ------------------------------------------------------------
const taxScanSpy = vi.fn();
const taxPersistSpy = vi.fn();
const coachRunSpy = vi.fn();
const coachPersistSpy = vi.fn();
const predictionSnapshotSpy = vi.fn();
const stormFetchSpy = vi.fn();
const stormPersistSpy = vi.fn();
const stormZipsSpy = vi.fn();
const sendResendSpy = vi.fn();
const pingHealthcheckSpy = vi.fn();
const claimSpy = vi.fn();
const completeSpy = vi.fn();

vi.mock('@/lib/cron-idempotency', () => ({
  tryClaimCronRun: (...args: unknown[]) => claimSpy(...args),
  markCronRunComplete: (...args: unknown[]) => completeSpy(...args),
  todayKeyET: () => '2026-05-13',
  thisWeekKeyET: () => '2026-05-10',
}));

vi.mock('@/lib/cron-auth', () => ({
  cronIsAuthorized: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/healthchecks', () => ({
  pingHealthcheck: (...args: unknown[]) => pingHealthcheckSpy(...args),
}));

vi.mock('@/lib/resend-client', () => ({
  sendResendEmail: (...args: unknown[]) => sendResendSpy(...args),
}));

vi.mock('@/lib/tax-harvest-engine', () => ({
  runTaxHarvestScan: (...args: unknown[]) => taxScanSpy(...args),
  persistSuggestions: (...args: unknown[]) => taxPersistSpy(...args),
}));

vi.mock('@/lib/coach-engine', () => ({
  runCoachReview: (...args: unknown[]) => coachRunSpy(...args),
  persistCoachReview: (...args: unknown[]) => coachPersistSpy(...args),
}));

vi.mock('@/lib/prediction-markets', () => ({
  takePredictionSnapshot: (...args: unknown[]) => predictionSnapshotSpy(...args),
  // Used by weekly-report (irrelevant here) but mock to be safe.
  fetchLatestSnapshots: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/storm-engine', () => ({
  evaluateStorms: vi.fn().mockReturnValue([]),
  fetchNhcActiveStorms: (...args: unknown[]) => stormFetchSpy(...args),
  loadTerritoryZips: (...args: unknown[]) => stormZipsSpy(...args),
  miamiMockStorm: vi.fn().mockReturnValue({ id: 'mock', name: 'Mock' }),
  persistAlertCandidates: (...args: unknown[]) => stormPersistSpy(...args),
}));

// Minimal request shim — these routes only read auth + url + headers.
function makeReq(): NextRequest {
  const url = new URL('https://example.com/api/cron/test');
  return {
    method: 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ authorization: 'Bearer test-secret' }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

beforeEach(() => {
  taxScanSpy.mockReset().mockResolvedValue([]);
  taxPersistSpy.mockReset().mockResolvedValue({ inserted: 0, week_of: '2026-05-10' });
  coachRunSpy.mockReset().mockResolvedValue({
    trade_count: 0,
    pnl_usd: 0,
    patterns_detected: [],
    primary_rule_for_next_week: 'rule',
    review_markdown: '',
    model_used: 'claude-test',
  });
  coachPersistSpy.mockReset().mockResolvedValue({ weekOf: '2026-05-10', id: 'cr-1' });
  predictionSnapshotSpy.mockReset().mockResolvedValue({ inserted: 0, deltas: [] });
  stormFetchSpy.mockReset().mockResolvedValue([]);
  stormZipsSpy.mockReset().mockResolvedValue({});
  stormPersistSpy.mockReset().mockResolvedValue({ created: 0, unchanged: 0 });
  sendResendSpy.mockReset().mockResolvedValue({ ok: true, id: 'resend-1' });
  pingHealthcheckSpy.mockReset().mockResolvedValue(undefined);
  claimSpy.mockReset();
  completeSpy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Lazy-import so module-level imports see our mocks. Static literals only
// to keep vite-plugin's dynamic-import analyzer happy.
async function loadHandler(route: 'tax-harvest' | 'coach-review' | 'prediction-snapshot' | 'storm-watch') {
  switch (route) {
    case 'tax-harvest':
      return (await import('../tax-harvest/route')).GET as (req: NextRequest) => Promise<Response>;
    case 'coach-review':
      return (await import('../coach-review/route')).GET as (req: NextRequest) => Promise<Response>;
    case 'prediction-snapshot':
      return (await import('../prediction-snapshot/route')).GET as (req: NextRequest) => Promise<Response>;
    case 'storm-watch':
      return (await import('../storm-watch/route')).GET as (req: NextRequest) => Promise<Response>;
  }
}

type SpyGetter = () => ReturnType<typeof vi.fn>;
type SendSpyGetter = () => ReturnType<typeof vi.fn> | null;

interface RouteCase {
  route: 'tax-harvest' | 'coach-review' | 'prediction-snapshot' | 'storm-watch';
  jobName: string;
  engineSpy: SpyGetter;
  sendSpy: SendSpyGetter;
}

const cases: RouteCase[] = [
  { route: 'tax-harvest', jobName: 'cron-tax-harvest', engineSpy: () => taxPersistSpy, sendSpy: () => sendResendSpy },
  { route: 'coach-review', jobName: 'cron-coach-review', engineSpy: () => coachPersistSpy, sendSpy: () => sendResendSpy },
  { route: 'prediction-snapshot', jobName: 'cron-prediction-snapshot', engineSpy: () => predictionSnapshotSpy, sendSpy: () => null },
  { route: 'storm-watch', jobName: 'cron-storm-watch', engineSpy: () => stormPersistSpy, sendSpy: () => null },
];

describe.each(cases)('S3 cron idempotency — $route', ({ route, engineSpy, sendSpy }) => {
  it('runs work + marks complete on first call', async () => {
    claimSpy.mockResolvedValueOnce(true);
    // Make the route do real "work" so we can see the side effect counters.
    if (route === 'tax-harvest') {
      taxScanSpy.mockResolvedValueOnce([
        {
          position_ticker: 'NVDA',
          unrealized_loss: -1000,
          swap_candidate_ticker: 'AMD',
          swap_correlation: 0.9,
          wash_sale_safe: true,
          estimated_tax_savings_usd: 370,
        },
      ]);
      taxPersistSpy.mockResolvedValueOnce({ inserted: 1, week_of: '2026-05-10' });
    }
    if (route === 'prediction-snapshot') {
      predictionSnapshotSpy.mockResolvedValueOnce({ inserted: 3, deltas: [] });
    }

    const handler = await loadHandler(route);
    const res = await handler(makeReq());

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(engineSpy()).toHaveBeenCalledTimes(1);
    // Email may or may not be sent depending on route's "send when?" rule;
    // these two crons unconditionally email (coach-review) or email-when-
    // results-exist (tax-harvest with inserted=1).
    if (route === 'coach-review') {
      expect(sendSpy()!).toHaveBeenCalledTimes(1);
    }
    if (route === 'tax-harvest') {
      // first-call mock had `inserted: 1`, so email fires
      expect(sendSpy()!).toHaveBeenCalledTimes(1);
    }
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with skipped response when claim returns false (already ran)', async () => {
    claimSpy.mockResolvedValueOnce(false);

    const handler = await loadHandler(route);
    const res = await handler(makeReq());

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('already_ran');

    // No engine, no email, no completion — the whole point of the lock.
    expect(engineSpy()).not.toHaveBeenCalled();
    const send = sendSpy();
    if (send) expect(send).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('claim is called with fail-CLOSED option (onRpcError: closed)', async () => {
    claimSpy.mockResolvedValueOnce(true);
    const handler = await loadHandler(route);
    await handler(makeReq());

    // [jobName, runKey, options]
    const lastCall = claimSpy.mock.calls[0];
    expect(typeof lastCall[0]).toBe('string'); // job_name
    expect(typeof lastCall[1]).toBe('string'); // run_key
    const opts = lastCall[2] ?? {};
    expect(opts.onRpcError).toBe('closed');
  });
});
