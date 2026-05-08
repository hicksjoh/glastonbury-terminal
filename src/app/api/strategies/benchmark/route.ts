import { NextRequest, NextResponse } from 'next/server';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'strategies/benchmark' });
  try {
    const strategy = req.nextUrl.searchParams.get('strategy') || '';
    const period = req.nextUrl.searchParams.get('period') || '1M';

    if (!FMP_KEY) {
      return NextResponse.json({ data: [] });
    }

    // Determine date range
    const now = new Date();
    const from = new Date();
    switch (period) {
      case '1W': from.setDate(now.getDate() - 7); break;
      case '1M': from.setMonth(now.getMonth() - 1); break;
      case '3M': from.setMonth(now.getMonth() - 3); break;
      case 'ALL': from.setFullYear(now.getFullYear() - 1); break;
      default: from.setMonth(now.getMonth() - 1);
    }

    const fromStr = from.toISOString().split('T')[0];
    const toStr = now.toISOString().split('T')[0];

    // Fetch SPY historical data
    const spyRes = await fetch(
      `${FMP_BASE}/historical-price-eod/light?symbol=SPY&from=${fromStr}&to=${toStr}&apikey=${FMP_KEY}`
    );

    if (!spyRes.ok) {
      return NextResponse.json({ data: [] });
    }

    const spyData = await spyRes.json();
    if (!Array.isArray(spyData) || spyData.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Reverse to chronological order
    const spyPrices = spyData.reverse();
    const spyBase = spyPrices[0]?.close || 1;

    // Generate simulated strategy returns based on strategy type
    // In production, this would pull from the trades table
    const seed = hashCode(strategy);
    const alpha = getStrategyAlpha(strategy);

    const data = spyPrices.map((day: { date: string; close: number }, i: number) => {
      const spyReturn = ((day.close - spyBase) / spyBase) * 100;
      // Simulate strategy return with consistent pseudo-random noise
      const noise = seededRandom(seed + i) * 2 - 1; // -1 to 1
      const strategyReturn = spyReturn + alpha + noise * 0.5 + (i / spyPrices.length) * alpha;

      return {
        date: day.date,
        spy: Number(spyReturn.toFixed(2)),
        strategy: Number(strategyReturn.toFixed(2)),
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'strategies/benchmark' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'benchmark threw');
    return NextResponse.json({ data: [], sentry_event_id: eventId });
  }
}

function getStrategyAlpha(type: string): number {
  switch (type) {
    case 'covered_call_wheel': return 2.5;
    case 'tax_loss_harvest': return 1.2;
    case 'auto_rebalance': return 0.8;
    case 'rsu_diversification': return 0.3;
    default: return 1.0;
  }
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
