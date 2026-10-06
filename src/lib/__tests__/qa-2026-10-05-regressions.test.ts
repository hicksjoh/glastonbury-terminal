/**
 * Regression tests for the 2026-10-05 production QA sweep.
 *
 * Every case corresponds to a defect that was live in production
 * (docs/operations/qa-sweep-2026-10-05.md) and is written to fail against the
 * old behaviour. Each `describe` names the finding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { classifyOrderResponse } from '@/lib/order-submit-outcome';
import { internalBaseUrl, internalFetch } from '@/lib/internal-fetch';
import {
  confluenceEvidence,
  isScannableMover,
  longSignalFitsRegime,
} from '@/lib/scanner-evidence';
import { classifyRegime } from '@/lib/market-regime';
import { toMonteCarloView, type MonteCarloApiResponse } from '@/lib/monte-carlo-view';
import { summarizeStormCoverage } from '@/lib/storm-coverage';

// ── B1 — order ticket reported success on failure ──────────────────────────
describe('B1 order ticket: only a 2xx is "submitted"', () => {
  it('treats an accepted order as submitted', () => {
    expect(classifyOrderResponse(true, 200, { id: 'abc' })).toEqual({ kind: 'submitted' });
  });

  it.each([
    [403, { error: 'insufficient buying power' }],
    [422, { message: 'qty must be > 0' }],
    [500, null],
    [429, 'not json'],
  ])('reports a %i as rejected, never submitted', (status, body) => {
    const out = classifyOrderResponse(false, status, body);
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.message).toContain(String(status));
  });

  it('surfaces the server reason so the order can be fixed', () => {
    const out = classifyOrderResponse(false, 403, { error: 'insufficient buying power' });
    expect(out).toEqual({ kind: 'rejected', message: 'Order rejected (403): insufficient buying power' });
  });

  it('keeps the live-safety codes on their own paths', () => {
    expect(classifyOrderResponse(false, 409, { code: 'typed_confirm_required', notional_usd: 25000 }))
      .toEqual({ kind: 'typed_confirm', notionalUsd: 25000 });
    for (const code of ['live_ack_required', 'live_ack_expired', 'live_ack_invalid']) {
      expect(classifyOrderResponse(false, 403, { code })).toEqual({ kind: 'ack_expired' });
    }
  });
});

// ── B3 — server-to-server self-fetches 401'd ───────────────────────────────
describe('B3 internalFetch: self-calls authenticate and target the app origin', () => {
  const env = { ...process.env };
  const fetchSpy = vi.fn(async () => new Response('{}'));

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it('sends x-internal-key so middleware admits the call', async () => {
    process.env.INTERNAL_API_KEY = 'k-123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://terminal.example.com';
    await internalFetch('/api/regime');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://terminal.example.com/api/regime');
    expect(new Headers(init.headers).get('x-internal-key')).toBe('k-123');
  });

  it('keeps caller headers and options', async () => {
    process.env.INTERNAL_API_KEY = 'k-123';
    await internalFetch('/api/agent-crew', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('production calls the public app URL, not the per-deployment host', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_URL = 'https://terminal.example.com/';
    process.env.VERCEL_URL = 'proj-abc123.vercel.app';
    expect(internalBaseUrl()).toBe('https://terminal.example.com');
  });

  // vercel.json pins NEXT_PUBLIC_APP_URL to the production host for every
  // environment. A preview that honoured it would drive production with the
  // internal key attached.
  it('a preview deployment calls itself, never production', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.NEXT_PUBLIC_APP_URL = 'https://terminal.example.com';
    process.env.VERCEL_URL = 'proj-preview-xyz.vercel.app';
    expect(internalBaseUrl()).toBe('https://proj-preview-xyz.vercel.app');
  });

  it('falls back to localhost off Vercel with nothing configured', () => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    expect(internalBaseUrl()).toBe('http://localhost:3000');
  });

  it('refuses to carry the internal key to anything but this app\'s /api', () => {
    expect(() => internalFetch('https://evil.example.com/api/x')).toThrow();
    expect(() => internalFetch('/login')).toThrow();
  });

  // Guard for the bug class, not just the ten call sites fixed: any server
  // file that builds its own origin and fetches /api/ with a bare fetch() is
  // an unauthenticated self-call. Unknown shapes are not skipped — every
  // `fetch(` whose first argument is a template literal reaching /api/ counts.
  it('no server module self-fetches /api with a bare fetch()', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === '__tests__' || name === 'node_modules') continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || p.endsWith('internal-fetch.ts')) continue;
        const src = readFileSync(p, 'utf8');
        // Client components fetch relative URLs with the session cookie.
        if (/^\s*['"]use client['"]/.test(src)) continue;
        if (/(?<![A-Za-z])fetch\(\s*`\$\{[^`]*\}\/api\//.test(src)) offenders.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders, 'use internalFetch() for self-calls').toEqual([]);
  });
});

// ── B5 — scanner sized buy calls off invented evidence ─────────────────────
describe('B5 scanner: evidence is only what was fetched', () => {
  it('drops penny names and >50% single-day spikes (the MI +683% case)', () => {
    expect(isScannableMover({ price: 7.0, change: 683 })).toBe(false);
    expect(isScannableMover({ price: 0.24, change: 74.5 })).toBe(false);
    expect(isScannableMover({ price: 3.99, change: 4 })).toBe(false);
    expect(isScannableMover({ price: 120, change: 6.2 })).toBe(true);
    expect(isScannableMover({ price: NaN, change: 6.2 })).toBe(false);
  });

  it('never claims flow, sentiment, 50DMA or regime from a price change', () => {
    const { sources } = confluenceEvidence({
      price: 120, change: 9, isGainer: true, isActive: true, insiderBuy: true,
    });
    expect(sources).toEqual(['top_gainer', 'most_active', 'insider_buy']);
    for (const fake of ['bullish_flow', 'positive_sentiment', 'above_50dma', 'regime_fit']) {
      expect(sources).not.toContain(fake);
    }
  });

  it('scores by how many independent facts matched', () => {
    const base = { price: 120, change: 9, isGainer: false, isActive: false, insiderBuy: false };
    expect(confluenceEvidence(base)).toEqual({ score: 0, sources: [] });
    expect(confluenceEvidence({ ...base, isGainer: true }).score).toBe(30);
    expect(confluenceEvidence({ ...base, isGainer: true, isActive: true, insiderBuy: true }).score).toBe(100);
  });

  it('only calls a long signal a regime fit in a classified bull regime', () => {
    expect(longSignalFitsRegime('bull_low_vol')).toBe(true);
    expect(longSignalFitsRegime('bear_low_vol')).toBe(false);
    expect(longSignalFitsRegime('unknown')).toBe(false);
  });

  it('the scanner route emits no position size and no hardcoded portfolio', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/scanner/route.ts'), 'utf8');
    expect(src).not.toMatch(/100000|100_000/);
    expect(src).not.toMatch(/winRate|scoreSignal/);
  });
});

// ── H9 — regime classifiers disagreed / defaulted on missing data ──────────
describe('H9 regime: one classifier, unknown on missing inputs', () => {
  it('classifies the four quadrants', () => {
    expect(classifyRegime(15, 0.6).regime).toBe('bull_low_vol');
    expect(classifyRegime(25, 0.6).regime).toBe('bull_high_vol');
    expect(classifyRegime(15, -0.6).regime).toBe('bear_low_vol');
    expect(classifyRegime(35, -0.6).regime).toBe('bear_high_vol');
  });

  it('is unknown, not a confident bear market, when a quote is missing', () => {
    for (const [v, m] of [[null, 0.5], [15, null], [undefined, undefined], [NaN, 1]] as const) {
      expect(classifyRegime(v, m)).toEqual({ regime: 'unknown', confidence: 0 });
    }
  });

  it('keeps confidence inside 0..1', () => {
    for (const v of [5, 19.9, 20, 29, 30, 80]) {
      for (const m of [-3, 0, 3]) {
        const { confidence } = classifyRegime(v, m);
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ── B7 — Risk page Monte Carlo tab shared no contract with its route ───────
describe('B7 monte-carlo view: route shape -> page shape', () => {
  const api: MonteCarloApiResponse = {
    var95: 5000, var99: 8000, cvar95: 6500, cvar99: 9500,
    expectedReturn: 1200,
    probabilityOfLoss: 0.42,
    percentiles: { p1: -8000, p5: -5000, p10: -3500, p25: -1000, p50: 1100, p75: 3000, p90: 5200, p95: 7000, p99: 11000 },
    histogram: [
      { rangeStart: -10000, rangeEnd: -5000, count: 60 },
      { rangeStart: -5000, rangeEnd: 0, count: 360 },
    ],
    stressTests: [{ name: '2008 Crash', description: 'GFC', portfolioImpact: -0.385, dollarLoss: -38500 }],
    portfolioValue: 100000,
  };

  it('renders dollar VaR as a signed percent of the portfolio', () => {
    const v = toMonteCarloView(api)!;
    expect(v.var95).toBeCloseTo(-5);
    expect(v.var99).toBeCloseTo(-8);
    expect(v.cvar95).toBeCloseTo(-6.5);
    expect(v.var95Dollar).toBe(5000);
  });

  it('carries probability of loss through (it used to read a missing key: 0.0%)', () => {
    expect(toMonteCarloView(api)!.probLoss).toBeCloseTo(42);
  });

  it('gives the page an array of percentile rows (.map on the object threw)', () => {
    const rows = toMonteCarloView(api)!.percentiles;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(9);
    expect(rows[1]).toEqual({ pct: '5th', returnPct: -5, dollarPL: -5000 });
  });

  it('maps histogram bounds into the same percent space as VaR', () => {
    const v = toMonteCarloView(api)!;
    expect(v.histogram[0]).toEqual({ min: -10, max: -5, midpoint: -7.5, count: 60 });
    // The VaR marker must land in a bin.
    expect(v.histogram.some((b) => b.min <= v.var95 && b.max > v.var95)).toBe(true);
  });

  it('uses the computed stress results, with no hardcoded fallbacks in the page', () => {
    expect(toMonteCarloView(api)!.stressTests).toEqual([
      { name: '2008 Crash', description: 'GFC', impact: -38.5, dollarLoss: -38500 },
    ]);
    const page = readFileSync(join(process.cwd(), 'src/app/risk/page.tsx'), 'utf8');
    for (const literal of ['-38.5', '-33.9', '-25.4', '-8.7']) expect(page).not.toContain(literal);
  });

  it('returns null rather than dividing by a zero or missing portfolio', () => {
    expect(toMonteCarloView(null)).toBeNull();
    expect(toMonteCarloView({ ...api, portfolioValue: 0 })).toBeNull();
  });
});

// ── H10 — storm watch reported an all-clear over 10 of 23 territories ──────
describe('H10 storm coverage: the gap is counted, not hidden', () => {
  const seeded = [
    ...Array.from({ length: 10 }, (_, i) => ({ territory_id: `T-${i}`, zip_codes: ['33101'] })),
    { territory_id: 'STLUCIE_FL-01', zip_codes: [] },
    { territory_id: 'WESTPALM_FL-03', zip_codes: [] },
    { territory_id: 'ORLANDO_FL-08', zip_codes: null },
  ];

  it('reports the production state as 10 of 23, incomplete', () => {
    const c = summarizeStormCoverage(seeded);
    expect(c.expected).toBe(23);
    expect(c.monitored).toBe(10);
    expect(c.notConfigured).toBe(10);
    expect(c.missingZips).toEqual(['STLUCIE_FL-01', 'WESTPALM_FL-03', 'ORLANDO_FL-08']);
    expect(c.complete).toBe(false);
  });

  it('is complete only when every expected territory has ZIPs', () => {
    const full = Array.from({ length: 23 }, (_, i) => ({ territory_id: `T-${i}`, zip_codes: ['33101'] }));
    expect(summarizeStormCoverage(full).complete).toBe(true);
    expect(summarizeStormCoverage([]).monitored).toBe(0);
  });
});

// ── B4 / B6 — synthetic and simulated values presented as real ─────────────
describe('B4/B6 no invented numbers in the render path', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('wheel tracker has no demo cycles', () => {
    const src = read('src/components/options/WheelTracker.tsx');
    expect(src).not.toMatch(/DEMO_CYCLES/);
    expect(src).not.toMatch(/totalPremium:\s*\d/);
  });

  it('strategy benchmark does not synthesize an alpha curve', () => {
    const src = read('src/app/api/strategies/benchmark/route.ts');
    expect(src).not.toMatch(/getStrategyAlpha|seededRandom|Math\.random/);
  });

  it('vol surface declares itself modelled and reports no mispricings', () => {
    const src = read('src/app/api/vol-surface/route.ts');
    expect(src).toMatch(/modelled:\s*true/);
    expect(src).not.toMatch(/const mispricings = findMispricing\(/);
  });

  it('monte carlo page has no literal portfolio fallbacks and does not read Alpaca equity', () => {
    const src = read('src/app/monte-carlo/page.tsx');
    for (const literal of ['720000', '82000', '1482000', '580000']) expect(src).not.toContain(literal);
    expect(src).not.toContain('/api/alpaca/account');
  });

  it('neither briefing route hardcodes holdings, and both label paper funds', () => {
    for (const p of ['src/app/api/briefing/route.ts', 'src/app/api/briefing/scheduled/route.ts']) {
      const src = read(p);
      expect(src, p).not.toMatch(/Static Holdings|~\$720K/);
      expect(src, p).toMatch(/brokerageAccountLabel\(\)/);
      expect(src, p).toMatch(/recordedHoldingsContext\(\)/);
    }
    expect(read('src/lib/briefing-holdings.ts')).toMatch(/SIMULATED funds/);
  });

  it('autopilot does not turn a scanner score into a win rate', () => {
    const src = read('src/app/api/autopilot/route.ts');
    expect(src).not.toMatch(/winRate:/);
    expect(src).not.toMatch(/calculateKelly/);
  });

  it('every reader of /api/regime reads the nested data.regime', () => {
    // The route answers { success, data: { regime } }. Four consumers read the
    // top level and silently never saw a regime.
    for (const p of [
      'src/app/page.tsx',
      'src/app/api/narrative/route.ts',
      'src/app/api/trade-replay/route.ts',
      'src/lib/keisha-context.ts',
    ]) {
      const src = read(p);
      expect(src, p).not.toMatch(/regimeJson\.regime\b|regimeRes\?\.regime\b|data\.regime \|\|/);
    }
  });
});

// ── B2 — the daily snapshot cron never wrote a row ─────────────────────────
describe('B2 portfolio snapshot: a cron GET takes the snapshot', () => {
  const upsert = vi.fn();
  const listSelect = vi.fn();
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    upsert.mockReset();
    listSelect.mockReset();
    process.env.CRON_SECRET = 'cron-secret-value';
    process.env.SESSION_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long-indeed';

    vi.doMock('@/lib/api-rate-limit', () => ({
      RATE: { WRITE: {} },
      withRateLimit: (_n: string, _r: unknown, fn: unknown) => fn,
    }));
    vi.doMock('@/lib/healthchecks', () => ({ pingHealthcheck: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/alpaca', () => ({
      getAccount: vi.fn(async () => ({ equity: '100000', cash: '100000', last_equity: '100000' })),
      getPositions: vi.fn(async () => []),
    }));
    vi.doMock('@/lib/supabase', () => ({
      createServiceClient: () => ({
        from: (table: string) => {
          if (table === 'wealth_assets') {
            return {
              select: async () => ({
                data: [
                  { asset_class: 'franchise', current_value: 1150000 },
                  { asset_class: 'rsu', current_value: 1489000 },
                  { asset_class: 'real_estate', current_value: 580000 },
                  { asset_class: 'cash', current_value: 75000 },
                ],
                error: null,
              }),
            };
          }
          return {
            upsert: (row: Record<string, unknown>) => {
              upsert(row);
              return { select: () => ({ single: async () => ({ data: { id: 's1', date: row.date }, error: null }) }) };
            },
            select: () => {
              listSelect();
              const q: Record<string, unknown> = {};
              q.order = () => q; q.gte = () => q; q.lte = () => q;
              q.limit = async () => ({ data: [], error: null });
              return q;
            },
          };
        },
      }),
    }));
  });
  afterEach(() => {
    process.env = { ...env };
    vi.doUnmock('@/lib/api-rate-limit');
    vi.doUnmock('@/lib/healthchecks');
    vi.doUnmock('@/lib/alpaca');
    vi.doUnmock('@/lib/supabase');
  });

  const req = (headers: Record<string, string>) => {
    const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      url: 'https://terminal.example.com/api/portfolio/snapshot',
      headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
      cookies: { get: () => undefined },
      nextUrl: { searchParams: new URLSearchParams() },
    } as unknown as NextRequest;
  };

  it('writes a row when Vercel cron GETs with the bearer secret', async () => {
    const { GET } = await import('@/app/api/portfolio/snapshot/route');
    const res = await (GET as (r: NextRequest) => Promise<Response>)(req({ authorization: 'Bearer cron-secret-value' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(listSelect).not.toHaveBeenCalled();
  });

  it('keeps a paper account\'s simulated equity out of net worth', async () => {
    delete process.env.TRADING_MODE;
    const { GET } = await import('@/app/api/portfolio/snapshot/route');
    await (GET as (r: NextRequest) => Promise<Response>)(req({ authorization: 'Bearer cron-secret-value' }));
    const row = upsert.mock.calls[0][0];
    expect(row.equity).toBe(100000);
    expect(row.net_worth).toBe(1150000 + 1489000 + 580000 + 75000);
  });

  it('rejects a wrong secret and writes nothing', async () => {
    const { GET } = await import('@/app/api/portfolio/snapshot/route');
    const res = await (GET as (r: NextRequest) => Promise<Response>)(req({ authorization: 'Bearer nope' }));
    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('still 401s an anonymous GET with no credentials', async () => {
    const { GET } = await import('@/app/api/portfolio/snapshot/route');
    const res = await (GET as (r: NextRequest) => Promise<Response>)(req({}));
    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });
});
