import { NextRequest, NextResponse } from 'next/server';

const FMP_KEY = process.env.FMP_API_KEY;

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const range = req.nextUrl.searchParams.get('range') || 'this_week';
    const detailSymbol = req.nextUrl.searchParams.get('symbol');

    // If requesting detail for a specific symbol
    if (detailSymbol) {
      return handleDetail(detailSymbol);
    }

    // Date range
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);

    if (range === 'this_week') {
      from.setDate(now.getDate() - now.getDay()); // Sunday
      to.setDate(from.getDate() + 6); // Saturday
    } else if (range === 'next_week') {
      from.setDate(now.getDate() + (7 - now.getDay()));
      to.setDate(from.getDate() + 6);
    } else {
      // Default: next 14 days
      to.setDate(now.getDate() + 14);
    }

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const calRes = await fetch(
      `https://financialmodelingprep.com/api/v3/earning_calendar?from=${fromStr}&to=${toStr}&apikey=${FMP_KEY}`
    );

    const calendar = calRes.ok ? await calRes.json() : [];
    if (!Array.isArray(calendar)) {
      return NextResponse.json({ upcoming: [], thisWeek: 0, highImpact: [] });
    }

    // Build upcoming list with surprise history
    const upcoming = [];
    const highImpact = [];

    for (const entry of calendar.slice(0, 50)) {
      const sym = entry.symbol;
      if (!sym) continue;

      // Fetch historical surprises
      let beatRate = 0;
      let avgSurprise = 0;
      let avgMove = 0;

      try {
        const surpriseRes = await fetch(
          `https://financialmodelingprep.com/api/v3/earnings-surprises/${sym}?apikey=${FMP_KEY}`
        );
        if (surpriseRes.ok) {
          const surprises = await surpriseRes.json();
          if (Array.isArray(surprises) && surprises.length > 0) {
            const recent = surprises.slice(0, 8);
            const beats = recent.filter((s: { actualEarningResult?: number; estimatedEarning?: number }) =>
              (s.actualEarningResult || 0) > (s.estimatedEarning || 0)
            ).length;
            beatRate = Math.round((beats / recent.length) * 100);
            avgSurprise = recent.reduce((sum: number, s: { actualEarningResult?: number; estimatedEarning?: number }) => {
              const actual = s.actualEarningResult || 0;
              const est = s.estimatedEarning || 1;
              return sum + ((actual - est) / Math.abs(est || 1)) * 100;
            }, 0) / recent.length;
          }
        }
      } catch {
        // Skip surprise history
      }

      // Estimate average earnings day move (simplified: use surprise magnitude)
      avgMove = Math.abs(avgSurprise) * 0.5 + 3; // baseline 3% + scaled surprise

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
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleDetail(symbol: string) {
  const FMP = process.env.FMP_API_KEY;

  const [surpriseRes, historicalRes] = await Promise.all([
    fetch(`https://financialmodelingprep.com/api/v3/earnings-surprises/${symbol}?apikey=${FMP}`),
    fetch(`https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbol}?limit=20&apikey=${FMP}`),
  ]);

  const surprises = surpriseRes.ok ? await surpriseRes.json() : [];
  const historical = historicalRes.ok ? await historicalRes.json() : [];

  return NextResponse.json({
    symbol,
    surprises: Array.isArray(surprises) ? surprises.slice(0, 12) : [],
    historical: Array.isArray(historical) ? historical.slice(0, 20) : [],
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
