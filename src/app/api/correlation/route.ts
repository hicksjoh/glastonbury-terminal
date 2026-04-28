import { NextRequest, NextResponse } from 'next/server';
import { pearsonCorrelation, correlationMatrix, diversificationScore } from '@/lib/correlation';
import { getHistoricalPrices } from '@/lib/fmp-client';

const FMP_KEY = process.env.FMP_API_KEY;

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const symbolsParam = req.nextUrl.searchParams.get('symbols') || 'AAPL,NVDA,MSFT,VTI';
    const period = Number(req.nextUrl.searchParams.get('period') || 90);
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    if (symbols.length < 2) {
      return NextResponse.json({ error: 'At least 2 symbols required' }, { status: 400 });
    }

    // Fetch historical prices for all symbols in parallel via the /stable client.
    const priceResults = await Promise.all(
      symbols.map(symbol => getHistoricalPrices(symbol, { timeseries: period, light: true })),
    );

    // Calculate daily returns for each symbol
    const allReturns: number[][] = [];
    const validSymbols: string[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const data = priceResults[i];
      const historical = data?.historical;
      if (!Array.isArray(historical) || historical.length < 10) continue;

      // Prices are newest first, reverse for chronological order
      const prices = historical.reverse().map((d: { close: number }) => d.close);
      const returns: number[] = [];
      for (let j = 1; j < prices.length; j++) {
        if (prices[j - 1] > 0) {
          returns.push((prices[j] - prices[j - 1]) / prices[j - 1]);
        }
      }

      if (returns.length > 5) {
        allReturns.push(returns);
        validSymbols.push(symbols[i]);
      }
    }

    if (allReturns.length < 2) {
      return NextResponse.json({ error: 'Insufficient price data for correlation' }, { status: 400 });
    }

    // Compute correlation matrix
    const matrix = correlationMatrix(allReturns);

    // Find high correlation pairs
    const highCorrelation: { pair: [string, string]; correlation: number }[] = [];
    for (let i = 0; i < validSymbols.length; i++) {
      for (let j = i + 1; j < validSymbols.length; j++) {
        if (Math.abs(matrix[i][j]) > 0.8) {
          highCorrelation.push({
            pair: [validSymbols[i], validSymbols[j]],
            correlation: Math.round(matrix[i][j] * 1000) / 1000,
          });
        }
      }
    }

    // Calculate portfolio beta (vs SPY)
    let portfolioBeta = 1.0;
    const spyIndex = validSymbols.indexOf('SPY');
    if (spyIndex === -1) {
      // Fetch SPY data for beta calculation
      try {
        const spyData = await getHistoricalPrices('SPY', { timeseries: period, light: true });
        if (spyData) {
          const spyHist = spyData.historical;
          if (Array.isArray(spyHist) && spyHist.length > 10) {
            const spyPrices = spyHist.reverse().map((d: { close: number }) => d.close);
            const spyReturns: number[] = [];
            for (let j = 1; j < spyPrices.length; j++) {
              if (spyPrices[j - 1] > 0) {
                spyReturns.push((spyPrices[j] - spyPrices[j - 1]) / spyPrices[j - 1]);
              }
            }

            // Portfolio beta = avg beta of all symbols
            let totalBeta = 0;
            for (const ret of allReturns) {
              const minLen = Math.min(ret.length, spyReturns.length);
              const corr = pearsonCorrelation(ret.slice(0, minLen), spyReturns.slice(0, minLen));
              const stdRet = std(ret);
              const stdSpy = std(spyReturns);
              const beta = stdSpy > 0 ? (corr * stdRet / stdSpy) : 1;
              totalBeta += beta;
            }
            portfolioBeta = Math.round((totalBeta / allReturns.length) * 1000) / 1000;
          }
        }
      } catch {
        // Default beta
      }
    }

    const divScore = diversificationScore(matrix);

    // Hedge suggestion
    let hedgeSuggestion: string | null = null;
    if (portfolioBeta > 1.2) {
      hedgeSuggestion = `Portfolio beta is ${portfolioBeta.toFixed(2)}. Consider hedging with short SPY or long VXX to reduce systematic risk.`;
    } else if (divScore < 30) {
      hedgeSuggestion = `Low diversification (score: ${divScore}). Consider adding uncorrelated assets like bonds (TLT), commodities (GLD), or international (EFA).`;
    }

    // Round matrix values
    const roundedMatrix = matrix.map(row => row.map(v => Math.round(v * 1000) / 1000));

    return NextResponse.json({
      matrix: roundedMatrix,
      symbols: validSymbols,
      highCorrelation,
      portfolioBeta,
      hedgeSuggestion,
      diversificationScore: divScore,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function std(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}
