import { NextRequest, NextResponse } from 'next/server';
import { runMonteCarlo, stressTest, MCPosition } from '@/lib/monte-carlo-risk';
import { createServiceClient } from '@/lib/supabase';

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_KEY = process.env.ALPACA_API_KEY_ID || '';
const ALPACA_SECRET = process.env.ALPACA_API_SECRET_KEY || '';
const FMP_KEY = process.env.FMP_API_KEY || '';

interface AlpacaPosition {
  symbol: string;
  market_value: string;
  qty: string;
  current_price: string;
}

interface FMPHistorical {
  historical: Array<{ date: string; close: number }>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let symbols: string[] = body.symbols || [];
    const simulations: number = body.simulations || 10_000;
    const horizon: number = body.horizon || 21;

    let weights: number[] = [];
    let portfolioValue = 0;

    // ---------------------------------------------------------------
    // 1. If no symbols provided, fetch current portfolio from Alpaca
    // ---------------------------------------------------------------
    if (symbols.length === 0) {
      if (!ALPACA_KEY || !ALPACA_SECRET) {
        return NextResponse.json(
          { error: 'Alpaca API keys not configured and no symbols provided' },
          { status: 400 }
        );
      }

      const alpacaRes = await fetch(`${ALPACA_BASE}/v2/positions`, {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        },
      });

      if (!alpacaRes.ok) {
        return NextResponse.json(
          { error: `Alpaca API error: ${alpacaRes.status}` },
          { status: 502 }
        );
      }

      const positions: AlpacaPosition[] = await alpacaRes.json();

      if (positions.length === 0) {
        return NextResponse.json(
          { error: 'No positions found in Alpaca portfolio' },
          { status: 404 }
        );
      }

      symbols = positions.map((p) => p.symbol);
      const marketValues = positions.map((p) => Math.abs(parseFloat(p.market_value)));
      portfolioValue = marketValues.reduce((sum, v) => sum + v, 0);
      weights = marketValues.map((v) => v / portfolioValue);
    } else {
      // Equal weights when symbols are provided manually
      weights = symbols.map(() => 1 / symbols.length);
      portfolioValue = 100_000; // default notional
    }

    // ---------------------------------------------------------------
    // 2. Fetch 252 days of historical prices from FMP
    // ---------------------------------------------------------------
    if (!FMP_KEY) {
      return NextResponse.json(
        { error: 'FMP API key not configured' },
        { status: 400 }
      );
    }

    const dailyReturns: Record<string, number[]> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await fetch(
            `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?timeseries=252&apikey=${FMP_KEY}`
          );
          if (!res.ok) return;

          const data: FMPHistorical = await res.json();
          if (!data.historical || data.historical.length < 2) return;

          // FMP returns newest-first; reverse to chronological
          const prices = [...data.historical].reverse();
          const returns: number[] = [];
          for (let i = 1; i < prices.length; i++) {
            returns.push(
              (prices[i].close - prices[i - 1].close) / prices[i - 1].close
            );
          }
          dailyReturns[symbol] = returns;
        } catch {
          // skip symbols that fail
        }
      })
    );

    // Filter out symbols that had no data
    const validSymbols: string[] = [];
    const validWeights: number[] = [];
    for (let i = 0; i < symbols.length; i++) {
      if (dailyReturns[symbols[i]] && dailyReturns[symbols[i]].length > 10) {
        validSymbols.push(symbols[i]);
        validWeights.push(weights[i]);
      }
    }

    if (validSymbols.length === 0) {
      return NextResponse.json(
        { error: 'No historical data available for any provided symbols' },
        { status: 400 }
      );
    }

    // Re-normalize weights after filtering
    const weightSum = validWeights.reduce((s, w) => s + w, 0);
    const normalizedWeights = validWeights.map((w) => w / weightSum);

    // ---------------------------------------------------------------
    // 3. Build MCPosition array
    // ---------------------------------------------------------------
    const mcPositions: MCPosition[] = validSymbols.map((symbol, i) => ({
      symbol,
      weight: normalizedWeights[i],
      returns: dailyReturns[symbol],
    }));

    // ---------------------------------------------------------------
    // 4. Run Monte Carlo simulation and stress tests
    // ---------------------------------------------------------------
    const mcResult = runMonteCarlo(mcPositions, portfolioValue, {
      simulations,
      horizon,
      confidenceLevels: [0.95, 0.99],
    });

    const stressResults = stressTest(mcPositions, portfolioValue);

    // ---------------------------------------------------------------
    // 5. Build histogram buckets from scenarios (20 buckets)
    // ---------------------------------------------------------------
    const scenarios = mcResult.scenarios;
    const minVal = mcResult.worstCase;
    const maxVal = mcResult.bestCase;
    const bucketCount = 20;
    const bucketSize = (maxVal - minVal) / bucketCount;

    const histogram = Array.from({ length: bucketCount }, (_, i) => {
      const rangeStart = minVal + i * bucketSize;
      const rangeEnd = rangeStart + bucketSize;
      const count = scenarios.filter(
        (s) => s >= rangeStart && (i === bucketCount - 1 ? s <= rangeEnd : s < rangeEnd)
      ).length;
      return {
        rangeStart: Math.round(rangeStart),
        rangeEnd: Math.round(rangeEnd),
        count,
        frequency: count / simulations,
      };
    });

    // ---------------------------------------------------------------
    // 6. Try to store results in Supabase
    // ---------------------------------------------------------------
    try {
      if (
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        const supabase = createServiceClient();
        await (supabase as any).from('monte_carlo_results').insert({
          portfolio_snapshot: validSymbols.map((s, i) => ({
            symbol: s,
            weight: normalizedWeights[i],
          })),
          var_95: mcResult.var95,
          var_99: mcResult.var99,
          cvar_95: mcResult.cvar95,
          cvar_99: mcResult.cvar99,
          expected_return: mcResult.expectedReturn,
          probability_of_loss: mcResult.probabilityOfLoss,
          stress_tests: stressResults,
          simulations,
          horizon,
        });
      }
    } catch {
      // Supabase storage is best-effort; don't fail the request
    }

    // ---------------------------------------------------------------
    // 7. Return response
    // ---------------------------------------------------------------
    return NextResponse.json({
      var95: mcResult.var95,
      var99: mcResult.var99,
      cvar95: mcResult.cvar95,
      cvar99: mcResult.cvar99,
      expectedReturn: mcResult.expectedReturn,
      probabilityOfLoss: mcResult.probabilityOfLoss,
      percentiles: mcResult.percentiles,
      histogram,
      stressTests: stressResults,
      portfolioValue,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Monte Carlo risk error:', error);
    return NextResponse.json(
      { error: 'Monte Carlo simulation failed' },
      { status: 500 }
    );
  }
}
