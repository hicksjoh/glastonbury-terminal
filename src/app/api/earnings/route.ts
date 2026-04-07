import { NextRequest, NextResponse } from 'next/server';
import { apiFetchWithFallback } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

interface EarningsCalendarEntry {
  symbol?: string;
  companyName?: string;
  date?: string;
  time?: string;
  epsEstimated?: number;
  revenueEstimated?: number;
  [k: string]: unknown;
}

interface SurpriseEntry {
  actualEarningResult?: number;
  estimatedEarning?: number;
  [k: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const range = req.nextUrl.searchParams.get('range') || 'this_week';
    const detailSymbol = req.nextUrl.searchParams.get('symbol');

    if (detailSymbol) {
      return handleDetail(detailSymbol);
    }

    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);

    if (range === 'this_week') {
      from.setDate(now.getDate() - now.getDay());
      to.setDate(from.getDate() + 6);
    } else if (range === 'next_week') {
      from.setDate(now.getDate() + (7 - now.getDay()));
      to.setDate(from.getDate() + 6);
    } else {
      to.setDate(now.getDate() + 14);
    }

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const calResult = await apiFetchWithFallback<EarningsCalendarEntry[]>(
      'fmp', '/v3/earning_calendar', { from: fromStr, to: toStr }, [],
      { cacheTtlMs: 60 * 60 * 1000 },
    );

    const calendar = Array.isArray(calResult.data) ? calResult.data : [];
    if (calendar.length === 0) {
      return NextResponse.json({
        upcoming: [], thisWeek: 0, highImpact: [],
        _meta: calResult._meta,
      });
    }

    // Limit surprise fetches to top 20 to conserve FMP budget
    const upcoming = [];
    const highImpact = [];

    for (const entry of calendar.slice(0, 20)) {
      const sym = entry.symbol;
      if (!sym) continue;

      let beatRate = 0, avgSurprise = 0, avgMove = 0;

      try {
        const surpriseResult = await apiFetchWithFallback<SurpriseEntry[]>(
          'fmp', `/v3/earnings-surprises/${encodeURIComponent(sym)}`, {}, [],
          { cacheTtlMs: 24 * 60 * 60 * 1000 }, // 24hr cache — historical data
        );
        const surprises = Array.isArray(surpriseResult.data) ? surpriseResult.data : [];
        if (surprises.length > 0) {
          const recent = surprises.slice(0, 8);
          const beats = recent.filter(s => (s.actualEarningResult || 0) > (s.estimatedEarning || 0)).length;
          beatRate = Math.round((beats / recent.length) * 100);
          avgSurprise = recent.reduce((sum, s) => {
            const actual = s.actualEarningResult || 0;
            const est = s.estimatedEarning || 1;
            return sum + ((actual - est) / Math.abs(est || 1)) * 100;
          }, 0) / recent.length;
        }
      } catch { /* skip surprise history */ }

      avgMove = Math.abs(avgSurprise) * 0.5 + 3;

      const item = {
        symbol: sym,
        company: entry.companyName || sym,
        date: entry.date || '',
        time: entry.time || 'bmo',
        epsEstimate: entry.epsEstimated || null,
        revenueEstimate: entry.revenueEstimated || null,
        surpriseHistory: {
          beatRate,
          avgSurprise: Math.round(avgSurprise * 100) / 100,
          avgMoveOnEarnings: Math.round(avgMove * 100) / 100,
        },
        ivAnalysis: {
          currentIV: null as number | null,
          avgPostEarningsIV: null as number | null,
          crushEstimate: null as number | null,
          straddle_price: null as number | null,
        },
        playRecommendation: generatePlayRec(beatRate, avgMove, avgSurprise),
      };

      upcoming.push(item);
      if (avgMove > 8) highImpact.push(item);
    }

    return NextResponse.json({
      upcoming,
      thisWeek: upcoming.length,
      highImpact,
      _meta: calResult._meta,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

async function handleDetail(symbol: string) {
  const [surpriseRes, historicalRes] = await Promise.all([
    apiFetchWithFallback<unknown[]>('fmp', `/v3/earnings-surprises/${encodeURIComponent(symbol)}`, {}, [], { cacheTtlMs: 24 * 60 * 60 * 1000 }),
    apiFetchWithFallback<unknown[]>('fmp', `/v3/historical/earning_calendar/${encodeURIComponent(symbol)}`, { limit: '20' }, [], { cacheTtlMs: 24 * 60 * 60 * 1000 }),
  ]);

  return NextResponse.json({
    symbol,
    surprises: Array.isArray(surpriseRes.data) ? surpriseRes.data.slice(0, 12) : [],
    historical: Array.isArray(historicalRes.data) ? historicalRes.data.slice(0, 20) : [],
    _meta: buildMeta({
      source: 'fmp',
      live: surpriseRes._meta.live && historicalRes._meta.live,
      cached: surpriseRes._meta.cached || historicalRes._meta.cached,
    }),
  });
}

function generatePlayRec(beatRate: number, avgMove: number, avgSurprise: number): string {
  if (avgMove > 10 && beatRate > 70) {
    return `High volatility play — ${beatRate}% beat rate with avg ${avgMove.toFixed(1)}% move. Consider long straddle or call spread.`;
  }
  if (avgMove < 4 && beatRate > 60) {
    return `Low vol + consistent beater. Sell iron condor to collect premium from IV crush.`;
  }
  if (beatRate < 40) {
    return `Weak beat rate (${beatRate}%). Consider put spread or avoiding the event.`;
  }
  if (avgSurprise > 5) {
    return `Strong positive surprise history (+${avgSurprise.toFixed(1)}%). Bullish bias warranted — consider call debit spread.`;
  }
  return `Neutral setup — ${beatRate}% beat rate, avg move ±${avgMove.toFixed(1)}%. Consider selling premium if IV is elevated.`;
}
