import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { driftRegimeScan } from '@/lib/drift-regime';
import { getHistoricalPrices } from '@/lib/fmp-client';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META'];

async function fetchHistoricalPrices(symbol: string): Promise<number[]> {
  const data = await getHistoricalPrices(symbol, { timeseries: 120, light: true });
  if (!data || data.historical.length === 0) return [];
  // fmp-client returns newest-first — reverse to chronological order
  return data.historical.map(d => d.close).reverse();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const watchlistParam = searchParams.get('watchlist');

    let symbols: string[];

    if (symbolsParam) {
      symbols = symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (watchlistParam === 'true') {
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from('watchlist')
          .select('symbol')
          .limit(20);

        if (error || !data || data.length === 0) {
          symbols = DEFAULT_SYMBOLS;
        } else {
          symbols = data.map((row: { symbol: string }) => row.symbol);
        }
      } catch {
        symbols = DEFAULT_SYMBOLS;
      }
    } else {
      symbols = DEFAULT_SYMBOLS;
    }

    // Fetch historical prices for all symbols in parallel
    const priceEntries = await Promise.all(
      symbols.map(async (symbol) => {
        const prices = await fetchHistoricalPrices(symbol);
        return [symbol, prices] as [string, number[]];
      })
    );

    const priceData = new Map<string, number[]>(priceEntries);

    // Run drift regime scan
    const scans = driftRegimeScan(symbols, priceData);

    // Build flattened response
    const scanResults = scans.map((s) => ({
      symbol: s.symbol,
      regime: s.regime.regime,
      hurstExponent: s.regime.hurstExponent,
      autocorrelation: s.regime.autocorrelation,
      confidence: s.regime.confidence,
      recommendedStrategy: s.recommendedStrategy,
      factorWeights: s.factorWeights,
    }));

    // Calculate summary counts
    const summary = {
      trending: scanResults.filter((s) => s.regime === 'trending').length,
      meanReverting: scanResults.filter((s) => s.regime === 'mean_reverting').length,
      randomWalk: scanResults.filter((s) => s.regime === 'random_walk').length,
    };

    return NextResponse.json({
      scans: scanResults,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Drift regime scan error:', error);
    return NextResponse.json(
      { error: 'Failed to run drift regime scan' },
      { status: 500 }
    );
  }
}
