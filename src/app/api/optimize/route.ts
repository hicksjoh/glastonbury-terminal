import { NextRequest, NextResponse } from 'next/server';
import { equilibriumReturns, blackLitterman, efficientFrontier, View } from '@/lib/black-litterman';
import { correlationMatrix } from '@/lib/correlation';
import { anthropic, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const FMP_KEY = process.env.FMP_API_KEY;

interface OptimizeRequest {
  symbols?: string[];
  useAIViews?: boolean;
  riskAversion?: number;
}

interface AlpacaPosition {
  symbol: string;
  market_value: string;
  qty: string;
  current_price: string;
  avg_entry_price: string;
}

interface FMPHistoricalEntry {
  date: string;
  close: number;
}

function calculateDailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

function calculateCovarianceMatrix(returnsMatrix: number[][]): number[][] {
  const n = returnsMatrix.length;
  const T = returnsMatrix[0].length;
  const means = returnsMatrix.map(
    (r) => r.reduce((sum, v) => sum + v, 0) / T
  );

  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returnsMatrix[i][t] - means[i]) * (returnsMatrix[j][t] - means[j]);
      }
      const value = sum / (T - 1);
      cov[i][j] = value;
      cov[j][i] = value;
    }
  }
  return cov;
}

function annualizeCovarianceMatrix(cov: number[][]): number[][] {
  return cov.map((row) => row.map((v) => v * 252));
}

async function fetchAlpacaPositions(): Promise<{
  symbols: string[];
  marketWeights: number[];
}> {
  const res = await fetch(`${ALPACA_BASE_URL}/v2/positions`, {
    headers: {
      'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID || '',
      'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY || '',
    },
  });

  if (!res.ok) {
    throw new Error(`Alpaca API error: ${res.status} ${res.statusText}`);
  }

  const positions: AlpacaPosition[] = await res.json();
  if (positions.length === 0) {
    throw new Error('No positions found in Alpaca portfolio');
  }

  const symbols = positions.map((p) => p.symbol);
  const marketValues = positions.map((p) => Math.abs(parseFloat(p.market_value)));
  const totalValue = marketValues.reduce((sum, v) => sum + v, 0);
  const marketWeights = marketValues.map((v) => v / totalValue);

  return { symbols, marketWeights };
}

async function fetchHistoricalPrices(symbol: string): Promise<number[]> {
  const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?timeseries=252&apikey=${FMP_KEY}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`FMP API error for ${symbol}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const historical: FMPHistoricalEntry[] = data.historical || [];

  if (historical.length < 10) {
    throw new Error(`Insufficient historical data for ${symbol}: only ${historical.length} days`);
  }

  // FMP returns newest first, reverse for chronological order
  return historical.map((h) => h.close).reverse();
}

async function generateAIViews(
  symbols: string[],
  eqReturns: number[],
  covMatrix: number[][]
): Promise<{ views: View[]; viewConfidences: number[]; aiViewDetails: Array<{ symbol: string; view: string; confidence: number; reasoning: string }> }> {
  try {
    const prompt = `You are a quantitative finance analyst. Given the following portfolio assets and their equilibrium expected annual returns derived from market cap weights via the Black-Litterman model, provide your views on expected returns.

Assets: ${symbols.join(', ')}
Equilibrium annual returns: ${symbols.map((s, i) => `${s}: ${(eqReturns[i] * 100).toFixed(2)}%`).join(', ')}

For each asset, provide your view as a JSON array. Each element should have:
- "symbol": the ticker
- "expectedReturn": your expected annual return as a decimal (e.g., 0.12 for 12%)
- "confidence": a number between 0 and 1 representing your confidence (higher = more confident)
- "reasoning": a brief explanation

Consider current market conditions, sector trends, and fundamental factors. Only provide views where you have a meaningful deviation from equilibrium. You may omit assets where you agree with the equilibrium.

Respond ONLY with a JSON array, no other text.`;

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_FALLBACK,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const parsed = JSON.parse(content.text);
    const views: View[] = [];
    const viewConfidences: number[] = [];
    const aiViewDetails: Array<{ symbol: string; view: string; confidence: number; reasoning: string }> = [];

    for (const item of parsed) {
      const idx = symbols.indexOf(item.symbol);
      if (idx === -1) continue;

      // Absolute view: asset i expected return = item.expectedReturn
      const P = Array(symbols.length).fill(0);
      P[idx] = 1;

      views.push({
        assets: P,
        expectedReturn: item.expectedReturn,
      });
      viewConfidences.push(item.confidence || 0.5);

      const direction = item.expectedReturn > eqReturns[idx] ? 'bullish' : 'bearish';
      aiViewDetails.push({
        symbol: item.symbol,
        view: `${direction} - expected ${(item.expectedReturn * 100).toFixed(2)}% annual return`,
        confidence: item.confidence,
        reasoning: item.reasoning,
      });
    }

    return { views, viewConfidences, aiViewDetails };
  } catch (error) {
    // Fallback: use equilibrium returns with small perturbations as views
    console.warn('AI views generation failed, using perturbation fallback:', error);
    const views: View[] = [];
    const viewConfidences: number[] = [];
    const aiViewDetails: Array<{ symbol: string; view: string; confidence: number; reasoning: string }> = [];

    for (let i = 0; i < symbols.length; i++) {
      const perturbation = (Math.random() - 0.5) * 0.02; // +/- 1%
      const P = Array(symbols.length).fill(0);
      P[i] = 1;

      views.push({
        assets: P,
        expectedReturn: eqReturns[i] + perturbation,
      });
      viewConfidences.push(0.3);

      aiViewDetails.push({
        symbol: symbols[i],
        view: `fallback - expected ${((eqReturns[i] + perturbation) * 100).toFixed(2)}% annual return`,
        confidence: 0.3,
        reasoning: 'AI analysis unavailable; using equilibrium with small perturbation',
      });
    }

    return { views, viewConfidences, aiViewDetails };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: OptimizeRequest = await request.json();
    const { useAIViews = false, riskAversion = 2.5 } = body;

    // 1. Get symbols and market weights
    let symbols: string[];
    let marketWeights: number[];

    if (body.symbols && body.symbols.length > 0) {
      symbols = body.symbols;
      // Equal weight when symbols are provided without portfolio data
      marketWeights = symbols.map(() => 1 / symbols.length);
    } else {
      const portfolio = await fetchAlpacaPositions();
      symbols = portfolio.symbols;
      marketWeights = portfolio.marketWeights;
    }

    // 2. Fetch historical prices and calculate daily returns
    const pricePromises = symbols.map((s) => fetchHistoricalPrices(s));
    const allPrices = await Promise.all(pricePromises);
    const allReturns = allPrices.map((prices) => calculateDailyReturns(prices));

    // Align return lengths (use minimum length across all assets)
    const minLen = Math.min(...allReturns.map((r) => r.length));
    const alignedReturns = allReturns.map((r) => r.slice(r.length - minLen));

    // 3-5. Calculate covariance matrix and equilibrium returns
    const dailyCov = calculateCovarianceMatrix(alignedReturns);
    const covMatrix = annualizeCovarianceMatrix(dailyCov);
    const eqReturns = equilibriumReturns(marketWeights, covMatrix, riskAversion);

    // 6. Correlation matrix for display
    const corrMatrix = correlationMatrix(alignedReturns);

    // 7. Generate views (AI or equilibrium-based)
    let views: View[] = [];
    let viewConfidences: number[] = [];
    let aiViewDetails: Array<{ symbol: string; view: string; confidence: number; reasoning: string }> = [];

    if (useAIViews) {
      const result = await generateAIViews(symbols, eqReturns, covMatrix);
      views = result.views;
      viewConfidences = result.viewConfidences;
      aiViewDetails = result.aiViewDetails;
    } else {
      // Use equilibrium returns as views with moderate confidence
      for (let i = 0; i < symbols.length; i++) {
        const P = Array(symbols.length).fill(0);
        P[i] = 1;
        views.push({ assets: P, expectedReturn: eqReturns[i] * (1 + (Math.random() - 0.5) * 0.1) });
        viewConfidences.push(0.5);
      }
    }

    // 8. Run Black-Litterman
    const blResult = blackLitterman(eqReturns, covMatrix, views, viewConfidences);
    const optimalWeights = blResult.optimalWeights;
    const posteriorReturns = blResult.posteriorReturns;

    // 9. Generate efficient frontier (20 points)
    const frontier = efficientFrontier(posteriorReturns, covMatrix, 20);

    // 10. Calculate portfolio metrics
    let expectedReturn = 0;
    let expectedRisk = 0;
    for (let i = 0; i < symbols.length; i++) {
      expectedReturn += optimalWeights[i] * posteriorReturns[i];
      for (let j = 0; j < symbols.length; j++) {
        expectedRisk += optimalWeights[i] * optimalWeights[j] * covMatrix[i][j];
      }
    }
    expectedRisk = Math.sqrt(expectedRisk);
    const riskFreeRate = 0.04; // Approximate current risk-free rate
    const sharpeRatio = (expectedReturn - riskFreeRate) / expectedRisk;

    // 11. Calculate changes
    const currentWeights: { [symbol: string]: number } = {};
    const optimalWeightsMap: { [symbol: string]: number } = {};
    const changes = symbols.map((symbol, i) => {
      currentWeights[symbol] = marketWeights[i];
      optimalWeightsMap[symbol] = optimalWeights[i];

      const diff = optimalWeights[i] - marketWeights[i];
      let action: string;
      if (Math.abs(diff) < 0.005) {
        action = 'HOLD';
      } else if (diff > 0) {
        action = 'BUY';
      } else {
        action = 'SELL';
      }

      return {
        symbol,
        current: marketWeights[i],
        optimal: optimalWeights[i],
        action,
      };
    });

    // 12. Generate rebalance instructions
    const rebalanceLines = changes
      .filter((c) => c.action !== 'HOLD')
      .sort((a, b) => Math.abs(b.optimal - b.current) - Math.abs(a.optimal - a.current))
      .map((c) => {
        const pctChange = ((c.optimal - c.current) * 100).toFixed(2);
        return `${c.action} ${c.symbol}: adjust from ${(c.current * 100).toFixed(1)}% to ${(c.optimal * 100).toFixed(1)}% (${c.action === 'BUY' ? '+' : ''}${pctChange}%)`;
      });

    const rebalanceInstructions =
      rebalanceLines.length > 0
        ? `Rebalance Instructions:\n${rebalanceLines.join('\n')}`
        : 'Portfolio is already optimally balanced. No trades needed.';

    return NextResponse.json({
      currentWeights,
      optimalWeights: optimalWeightsMap,
      changes,
      expectedReturn,
      expectedRisk,
      sharpeRatio,
      frontier: frontier.map((pt) => ({
        risk: pt.risk,
        return: pt.return,
        sharpe: pt.sharpe,
      })),
      aiViews: aiViewDetails,
      rebalanceInstructions,
      correlationMatrix: corrMatrix,
    });
  } catch (error: unknown) {
    console.error('Optimization error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error during optimization';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
