import { NextRequest, NextResponse } from 'next/server';
import { assessMacroRegime, MacroIndicators } from '@/lib/macro-regime';
import { getSupabase } from '@/lib/supabase';
import { apiFetchWithFallback, type ApiResult } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

// Hardcoded defaults — always tagged as fallback via _meta
const DEFAULTS: MacroIndicators = {
  yield10Y: 4.25,
  yield2Y: 4.0,
  fedFunds: 5.25,
  vix: 18,
  dxy: 104,
  copperGoldRatio: 0.18,
  creditSpread: 3.5,
  unemploymentRate: 3.8,
  ismManufacturing: 50,
  cpi: 3.2,
  gdpGrowth: 2.5,
};

// FRED series IDs for macro indicators
const FRED_SERIES = {
  gdpGrowth: 'A191RL1Q225SBEA',       // Real GDP growth rate
  unemploymentRate: 'UNRATE',           // Unemployment rate
  cpi: 'CPIAUCSL',                      // CPI all urban consumers
  fedFunds: 'FEDFUNDS',                // Fed funds effective rate
  yield10Y: 'DGS10',                   // 10Y treasury yield
  yield2Y: 'DGS2',                     // 2Y treasury yield
  creditSpread: 'BAMLH0A0HYM2',        // ICE BofA High Yield spread
  ismManufacturing: 'MANEMP',          // Manufacturing employment (proxy)
} as const;

// ---------------------------------------------------------------------------
// FRED fetcher — used when FRED_API_KEY is available
// ---------------------------------------------------------------------------

async function fetchFredSeries(seriesId: string): Promise<ApiResult<number | null>> {
  const result = await apiFetchWithFallback<{ observations?: { value: string }[] }>(
    'fred',
    '/series/observations',
    {
      series_id: seriesId,
      sort_order: 'desc',
      limit: '1',
      file_type: 'json',
    },
    { observations: [] },
    { cacheTtlMs: 6 * 60 * 60 * 1000 }, // 6hr cache — macro moves slow
  );

  const obs = result.data.observations;
  const val = obs?.[0]?.value;
  const num = val && val !== '.' ? parseFloat(val) : null;
  return { data: num, _meta: result._meta };
}

// ---------------------------------------------------------------------------
// FMP fetchers — existing fallback path
// ---------------------------------------------------------------------------

interface TreasuryEntry { year10: number; year2: number; [k: string]: unknown }
interface QuoteEntry { price: number; [k: string]: unknown }
interface EconomicEvent { date: string; event: string; country?: string; impact?: string; actual?: number | null; estimate?: number | null; previous?: number | null }

async function fetchFmpTreasury(): Promise<ApiResult<TreasuryEntry | null>> {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const result = await apiFetchWithFallback<TreasuryEntry[]>(
    'fmp', '/v4/treasury', { from: monthAgo, to: today }, [],
    { cacheTtlMs: 60 * 60 * 1000 },
  );
  return { data: result.data?.[0] ?? null, _meta: result._meta };
}

async function fetchFmpVix(): Promise<ApiResult<number | null>> {
  const result = await apiFetchWithFallback<QuoteEntry[]>(
    'fmp', '/v3/quote/%5EVIX', {}, [],
    { cacheTtlMs: 60 * 1000 },
  );
  return { data: result.data?.[0]?.price ?? null, _meta: result._meta };
}

async function fetchFmpCalendar(): Promise<ApiResult<EconomicEvent[]>> {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  return apiFetchWithFallback<EconomicEvent[]>(
    'fmp', '/v3/economic_calendar', { from: today, to: twoWeeks }, [],
    { cacheTtlMs: 60 * 60 * 1000 },
  );
}

// ---------------------------------------------------------------------------
// GET /api/macro
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  try {
    const hasFred = !!process.env.FRED_API_KEY;
    const sources: string[] = [];
    const sourceMetas: ApiMeta[] = [];

    let indicators: MacroIndicators;

    if (hasFred) {
      // Primary path: FRED for most indicators + FMP for VIX + calendar
      const [gdp, unemp, cpiRes, ffr, y10, y2, spread, vixRes, calRes] = await Promise.all([
        fetchFredSeries(FRED_SERIES.gdpGrowth),
        fetchFredSeries(FRED_SERIES.unemploymentRate),
        fetchFredSeries(FRED_SERIES.cpi),
        fetchFredSeries(FRED_SERIES.fedFunds),
        fetchFredSeries(FRED_SERIES.yield10Y),
        fetchFredSeries(FRED_SERIES.yield2Y),
        fetchFredSeries(FRED_SERIES.creditSpread),
        fetchFmpVix(),
        fetchFmpCalendar(),
      ]);

      sourceMetas.push(gdp._meta, unemp._meta, vixRes._meta, calRes._meta);
      sources.push('fred', 'fmp');

      indicators = {
        gdpGrowth: gdp.data ?? DEFAULTS.gdpGrowth,
        unemploymentRate: unemp.data ?? DEFAULTS.unemploymentRate,
        cpi: cpiRes.data ?? DEFAULTS.cpi,
        fedFunds: ffr.data ?? DEFAULTS.fedFunds,
        yield10Y: y10.data ?? DEFAULTS.yield10Y,
        yield2Y: y2.data ?? DEFAULTS.yield2Y,
        creditSpread: spread.data ?? DEFAULTS.creditSpread,
        vix: vixRes.data ?? DEFAULTS.vix,
        dxy: DEFAULTS.dxy,
        copperGoldRatio: DEFAULTS.copperGoldRatio,
        ismManufacturing: DEFAULTS.ismManufacturing,
      };

      // Build calendar from FMP
      var upcomingEvents = (calRes.data ?? [])
        .filter(e => e.country === 'US' || !e.country)
        .slice(0, 10)
        .map(e => ({ date: e.date, event: e.event, importance: e.impact ?? 'medium' }));

    } else {
      // Fallback path: FMP treasury + VIX
      const [treasuryRes, vixRes, calRes] = await Promise.all([
        fetchFmpTreasury(),
        fetchFmpVix(),
        fetchFmpCalendar(),
      ]);

      sourceMetas.push(treasuryRes._meta, vixRes._meta, calRes._meta);
      sources.push('fmp');

      indicators = {
        yield10Y: treasuryRes.data?.year10 ?? DEFAULTS.yield10Y,
        yield2Y: treasuryRes.data?.year2 ?? DEFAULTS.yield2Y,
        fedFunds: DEFAULTS.fedFunds,
        vix: vixRes.data ?? DEFAULTS.vix,
        dxy: DEFAULTS.dxy,
        copperGoldRatio: DEFAULTS.copperGoldRatio,
        creditSpread: DEFAULTS.creditSpread,
        unemploymentRate: DEFAULTS.unemploymentRate,
        ismManufacturing: DEFAULTS.ismManufacturing,
        cpi: DEFAULTS.cpi,
        gdpGrowth: DEFAULTS.gdpGrowth,
      };

      var upcomingEvents = (calRes.data ?? [])
        .filter(e => e.country === 'US' || !e.country)
        .slice(0, 10)
        .map(e => ({ date: e.date, event: e.event, importance: e.impact ?? 'medium' }));
    }

    // Assess regime
    const regime = assessMacroRegime(indicators);

    // Build interpretation
    const yieldCurveSlope = Math.round((indicators.yield10Y - indicators.yield2Y) * 100) / 100;
    const regimeLabel = regime.regime.replace('_', ' ');
    const fedActionMap = { hike: 'raise rates', hold: 'hold rates steady', cut: 'cut rates' } as const;
    const fedAction = fedActionMap[regime.fedPrediction.prediction as keyof typeof fedActionMap] ?? 'hold rates steady';

    const interpretation =
      `The macro environment is currently in a ${regimeLabel} regime ` +
      `(confidence: ${Math.round(regime.confidence * 100)}%). ` +
      `The yield curve slope is ${yieldCurveSlope > 0 ? '+' : ''}${yieldCurveSlope}%, ` +
      `VIX at ${indicators.vix} signals ${regime.factorBreakdown.vix?.signal ?? 'normal conditions'}. ` +
      `The Taylor Rule suggests the Fed should ${fedAction} ` +
      `(implied rate: ${regime.fedPrediction.impliedRate}%). ` +
      `Recommended allocation tilts toward ` +
      `${Object.entries(regime.allocation)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([k, v]) => `${k} (${Math.round(v * 100)}%)`)
        .join(' and ')}.`;

    // Store to Supabase (non-blocking)
    try {
      const supabase = getSupabase();
      await (supabase as any).from('macro_regime_history').insert({
        regime: regime.regime,
        confidence: regime.confidence,
        score: regime.score,
        indicators,
        allocation: regime.allocation,
        fed_prediction: regime.fedPrediction,
        recorded_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }

    // Determine if ALL data is live
    const allLive = sourceMetas.every(m => m.live);
    const primarySource = hasFred ? 'fred+fmp' : 'fmp';

    return NextResponse.json({
      regime: {
        name: regime.regime,
        confidence: regime.confidence,
        score: regime.score,
        factorBreakdown: regime.factorBreakdown,
      },
      indicators: {
        yield10Y: indicators.yield10Y,
        yield2Y: indicators.yield2Y,
        yieldCurveSlope,
        fedFunds: indicators.fedFunds,
        vix: indicators.vix,
        dxy: indicators.dxy,
        creditSpread: indicators.creditSpread,
        unemploymentRate: indicators.unemploymentRate,
        cpi: indicators.cpi,
        gdpGrowth: indicators.gdpGrowth,
      },
      fedPrediction: {
        action: regime.fedPrediction.prediction,
        confidence: regime.fedPrediction.confidence,
        impliedRate: regime.fedPrediction.impliedRate,
      },
      allocation: regime.allocation,
      upcomingEvents,
      interpretation,
      lastUpdated: new Date().toISOString(),
      _meta: buildMeta({
        source: primarySource,
        live: allLive,
        stale: sourceMetas.some(m => m.stale),
        cached: sourceMetas.some(m => m.cached),
      }),
    });
  } catch (error) {
    console.error('[macro] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch macro data',
        details: String(error),
        _meta: buildMeta({ source: 'error', live: false, error: String(error) }),
      },
      { status: 500 },
    );
  }
}
