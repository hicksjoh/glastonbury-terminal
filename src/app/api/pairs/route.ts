import { NextRequest, NextResponse } from 'next/server';
import {
  scanPairs,
  testCointegration,
  calculateSpread,
  generateSignal,
  backtestPair,
} from '@/lib/pairs-trading';
import { getHistoricalPrices } from '@/lib/fmp-client';

const FMP_KEY = process.env.FMP_API_KEY;

async function fetchPrices(symbol: string, lookback: number): Promise<number[]> {
  const data = await getHistoricalPrices(symbol, { timeseries: lookback, light: true });
  if (!data || data.historical.length === 0) {
    throw new Error(`No historical data returned for ${symbol}`);
  }
  // fmp-client returns newest-first; reverse to chronological order
  return data.historical.map(d => d.close).reverse();
}

// ─── Scanner Mode ────────────────────────────────────────────────────────────

async function handleScanner(symbols: string[], lookback: number) {
  const priceEntries = await Promise.all(
    symbols.map(async (sym) => {
      const prices = await fetchPrices(sym, lookback);
      return [sym, prices] as const;
    }),
  );

  const prices = new Map<string, number[]>();
  for (const [sym, p] of priceEntries) {
    prices.set(sym, p);
  }

  const pairs = scanPairs(symbols, prices);

  // Attach a quick backtest to each pair
  const enriched = pairs.map((pair) => {
    const pA = prices.get(pair.symbolA)!;
    const pB = prices.get(pair.symbolB)!;
    const backtest = backtestPair(pA, pB, { lookback: Math.min(60, lookback) });
    return { ...pair, backtest };
  });

  return NextResponse.json({ pairs: enriched, timestamp: new Date().toISOString() });
}

// ─── Detail Mode ─────────────────────────────────────────────────────────────

async function handleDetail(a: string, b: string, lookback: number) {
  const [pricesA, pricesB] = await Promise.all([
    fetchPrices(a, lookback),
    fetchPrices(b, lookback),
  ]);

  const cointegration = testCointegration(pricesA, pricesB);
  const spread = calculateSpread(pricesA, pricesB, cointegration.hedgeRatio);
  const signal = generateSignal(spread.zScore);
  const backtest = backtestPair(pricesA, pricesB);

  return NextResponse.json({
    symbolA: a,
    symbolB: b,
    hedgeRatio: cointegration.hedgeRatio,
    halfLife: cointegration.halfLife,
    spread: {
      history: spread.spread,
      mean: spread.mean,
      std: spread.std,
      zScore: spread.zScore,
      current: spread.current,
    },
    signal,
    backtest: {
      trades: backtest.trades,
      winRate: backtest.winRate,
      sharpe: backtest.sharpe,
      maxDrawdown: backtest.maxDrawdown,
      pnl: backtest.pnl,
      equityCurve: backtest.equityCurve,
    },
    cointegration: {
      isCointegrated: cointegration.isCointegrated,
      pValue: cointegration.pValue,
    },
    timestamp: new Date().toISOString(),
  });
}

// ─── GET Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY is not configured' }, { status: 500 });
    }

    const { searchParams } = request.nextUrl;
    const lookback = parseInt(searchParams.get('lookback') || '90', 10);
    const detail = searchParams.get('detail') === 'true';

    if (detail) {
      const a = searchParams.get('a');
      const b = searchParams.get('b');
      if (!a || !b) {
        return NextResponse.json(
          { error: 'Detail mode requires "a" and "b" query parameters' },
          { status: 400 },
        );
      }
      return await handleDetail(a.toUpperCase(), b.toUpperCase(), lookback);
    }

    // Scanner mode
    const symbolsParam = searchParams.get('symbols');
    if (!symbolsParam) {
      return NextResponse.json(
        { error: '"symbols" query parameter is required for scanner mode' },
        { status: 400 },
      );
    }

    const symbols = symbolsParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 symbols are required for pairs scanning' },
        { status: 400 },
      );
    }

    return await handleScanner(symbols, lookback);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/pairs] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
