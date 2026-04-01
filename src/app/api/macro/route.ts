import { NextRequest, NextResponse } from 'next/server';
import { assessMacroRegime, MacroIndicators } from '@/lib/macro-regime';
import { getSupabase } from '@/lib/supabase';

const FMP_KEY = process.env.FMP_API_KEY ?? '';

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

// ---------------------------------------------------------------------------
// FMP helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface TreasuryEntry {
  date: string;
  month1: number;
  month2: number;
  month3: number;
  month6: number;
  year1: number;
  year2: number;
  year3: number;
  year5: number;
  year7: number;
  year10: number;
  year20: number;
  year30: number;
}

interface QuoteEntry {
  symbol: string;
  price: number;
  change: number;
  changesPercentage: number;
  [key: string]: unknown;
}

interface EconomicEvent {
  date: string;
  event: string;
  country?: string;
  actual?: number | null;
  estimate?: number | null;
  previous?: number | null;
  impact?: string;
}

// ---------------------------------------------------------------------------
// GET /api/macro
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  try {
    // Parallel fetch from FMP
    const [treasuryData, vixData, calendarData] = await Promise.all([
      fetchJson<TreasuryEntry[]>(
        `https://financialmodelingprep.com/api/v4/treasury?from=2026-01-01&to=2026-03-31&apikey=${FMP_KEY}`,
      ),
      fetchJson<QuoteEntry[]>(
        `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${FMP_KEY}`,
      ),
      fetchJson<EconomicEvent[]>(
        `https://financialmodelingprep.com/api/v3/economic_calendar?from=2026-03-24&to=2026-04-07&apikey=${FMP_KEY}`,
      ),
    ]);

    // Build indicators from fetched data, falling back to defaults
    const latestTreasury = treasuryData?.length ? treasuryData[0] : null;
    const vixQuote = vixData?.length ? vixData[0] : null;

    const indicators: MacroIndicators = {
      yield10Y: latestTreasury?.year10 ?? DEFAULTS.yield10Y,
      yield2Y: latestTreasury?.year2 ?? DEFAULTS.yield2Y,
      fedFunds: DEFAULTS.fedFunds,
      vix: vixQuote?.price ?? DEFAULTS.vix,
      dxy: DEFAULTS.dxy,
      copperGoldRatio: DEFAULTS.copperGoldRatio,
      creditSpread: DEFAULTS.creditSpread,
      unemploymentRate: DEFAULTS.unemploymentRate,
      ismManufacturing: DEFAULTS.ismManufacturing,
      cpi: DEFAULTS.cpi,
      gdpGrowth: DEFAULTS.gdpGrowth,
    };

    // Assess regime
    const regime = assessMacroRegime(indicators);

    // Build upcoming events from economic calendar
    const upcomingEvents = (calendarData ?? [])
      .filter((e) => e.country === 'US' || !e.country)
      .slice(0, 10)
      .map((e) => ({
        date: e.date,
        event: e.event,
        importance: e.impact ?? 'medium',
      }));

    // Generate interpretation string from regime data
    const yieldCurveSlope = Math.round((indicators.yield10Y - indicators.yield2Y) * 100) / 100;
    const regimeLabel = regime.regime.replace('_', ' ');
    const fedActionMap = { hike: 'raise rates', hold: 'hold rates steady', cut: 'cut rates' };
    const fedAction = fedActionMap[regime.fedPrediction.prediction];

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

    // Try to store in Supabase (non-blocking)
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
    } catch {
      // Storage failure is non-critical
    }

    const response = {
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
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[macro] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch macro data', details: String(error) },
      { status: 500 },
    );
  }
}
