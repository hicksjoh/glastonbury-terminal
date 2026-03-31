import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

interface HistoricalPrice {
  date: string;
  close: number;
}

export async function POST(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP API key not configured' }, { status: 400 });
    }

    const { symbols, weights } = await req.json() as {
      symbols: string[];
      weights: number[];
    };

    if (!symbols || symbols.length === 0) {
      return NextResponse.json({
        var95: 0, maxDrawdown: 0, beta: 0, sharpe: 0,
        correlationMatrix: {}, stressTests: [], symbols: [],
      });
    }

    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch historical data for all symbols + SPY
    const allSymbols = Array.from(new Set([...symbols, 'SPY']));
    const priceData: Record<string, HistoricalPrice[]> = {};

    await Promise.all(
      allSymbols.map(async (sym) => {
        try {
          const res = await fetch(
            `${FMP_BASE}/historical-price-eod/light?symbol=${sym}&from=${fromDate}&to=${toDate}&apikey=${FMP_KEY}`
          );
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              priceData[sym] = data.reverse(); // chronological
            }
          }
        } catch {
          // skip
        }
      })
    );

    // Calculate daily returns for each symbol
    const returns: Record<string, number[]> = {};
    for (const sym of symbols) {
      const prices = priceData[sym];
      if (!prices || prices.length < 2) continue;
      returns[sym] = [];
      for (let i = 1; i < prices.length; i++) {
        returns[sym].push((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
      }
    }

    // Calculate portfolio daily returns (weighted)
    const normalizedWeights = weights.length === symbols.length
      ? weights
      : symbols.map(() => 1 / symbols.length);

    const returnLengths = symbols.map(s => (returns[s] || []).length).filter(l => l > 0);
    const minLen = returnLengths.length > 0 ? Math.min(...returnLengths) : 0;
    const portfolioReturns: number[] = [];

    for (let i = 0; i < minLen; i++) {
      let dayReturn = 0;
      for (let j = 0; j < symbols.length; j++) {
        const r = returns[symbols[j]];
        if (r && r[i] !== undefined) {
          dayReturn += r[i] * normalizedWeights[j];
        }
      }
      portfolioReturns.push(dayReturn);
    }

    // VaR (95% confidence) — historical simulation
    const sortedReturns = [...portfolioReturns].sort((a, b) => a - b);
    const varIndex = Math.floor(sortedReturns.length * 0.05);
    const var95 = sortedReturns[varIndex] || 0;

    // Max Drawdown
    let peak = 1;
    let maxDD = 0;
    let cumulative = 1;
    for (const r of portfolioReturns) {
      cumulative *= (1 + r);
      if (cumulative > peak) peak = cumulative;
      const dd = (peak - cumulative) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    // Portfolio Beta vs SPY
    const spyReturns: number[] = [];
    const spyPrices = priceData['SPY'];
    if (spyPrices && spyPrices.length > 1) {
      for (let i = 1; i < spyPrices.length; i++) {
        spyReturns.push((spyPrices[i].close - spyPrices[i - 1].close) / spyPrices[i - 1].close);
      }
    }

    let beta = 1;
    if (spyReturns.length > 0 && portfolioReturns.length > 0) {
      const len = Math.min(spyReturns.length, portfolioReturns.length);
      const avgPort = portfolioReturns.slice(0, len).reduce((a, b) => a + b, 0) / len;
      const avgSpy = spyReturns.slice(0, len).reduce((a, b) => a + b, 0) / len;

      let cov = 0, varSpy = 0;
      for (let i = 0; i < len; i++) {
        cov += (portfolioReturns[i] - avgPort) * (spyReturns[i] - avgSpy);
        varSpy += (spyReturns[i] - avgSpy) ** 2;
      }
      beta = varSpy > 0 ? cov / varSpy : 1;
    }

    // Sharpe Ratio (annualized, risk-free rate = 4.5%)
    const avgDailyReturn = portfolioReturns.length > 0
      ? portfolioReturns.reduce((a, b) => a + b, 0) / portfolioReturns.length
      : 0;
    const stdDev = Math.sqrt(
      portfolioReturns.reduce((sum, r) => sum + (r - avgDailyReturn) ** 2, 0) / (portfolioReturns.length - 1 || 1)
    );
    const annualizedReturn = avgDailyReturn * 252;
    const annualizedStd = stdDev * Math.sqrt(252);
    const sharpe = annualizedStd > 0 ? (annualizedReturn - 0.045) / annualizedStd : 0;

    // Correlation matrix
    const corrMatrix: Record<string, Record<string, number>> = {};
    for (const symA of symbols) {
      corrMatrix[symA] = {};
      for (const symB of symbols) {
        if (symA === symB) { corrMatrix[symA][symB] = 1; continue; }
        const rA = returns[symA] || [];
        const rB = returns[symB] || [];
        const len = Math.min(rA.length, rB.length);
        if (len < 10) { corrMatrix[symA][symB] = 0; continue; }

        const avgA = rA.slice(0, len).reduce((a, b) => a + b, 0) / len;
        const avgB = rB.slice(0, len).reduce((a, b) => a + b, 0) / len;

        let cov = 0, varA = 0, varB = 0;
        for (let i = 0; i < len; i++) {
          cov += (rA[i] - avgA) * (rB[i] - avgB);
          varA += (rA[i] - avgA) ** 2;
          varB += (rB[i] - avgB) ** 2;
        }

        const denom = Math.sqrt(varA * varB);
        corrMatrix[symA][symB] = denom > 0 ? Number((cov / denom).toFixed(3)) : 0;
      }
    }

    // Stress test scenarios
    const stressScenarios = [
      { name: '2008 Financial Crisis', equityShock: -0.38, bondShock: 0.20 },
      { name: 'COVID Crash (Mar 2020)', equityShock: -0.34, bondShock: 0.05 },
      { name: 'Interest Rate Shock (+2%)', equityShock: -0.10, bondShock: -0.15 },
      { name: 'Tech Correction (-20%)', techShock: -0.20, otherShock: -0.05 },
    ];

    const TECH_SECTORS = ['Technology', 'Communication Services'];
    const stressResults = stressScenarios.map(scenario => ({
      name: scenario.name,
      impacts: symbols.map((sym, i) => {
        let shock = scenario.equityShock || 0;
        if (scenario.techShock !== undefined) {
          // Use heuristic — tech symbols
          const techSyms = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN', 'NFLX', 'COIN'];
          shock = techSyms.includes(sym) ? scenario.techShock : (scenario.otherShock || -0.05);
        }
        return {
          symbol: sym,
          shock: Number((shock * 100).toFixed(1)),
          loss: Number((shock * normalizedWeights[i] * 100).toFixed(2)),
        };
      }),
    }));

    return NextResponse.json({
      var95: Number((var95 * 100).toFixed(2)),
      maxDrawdown: Number((maxDD * 100).toFixed(2)),
      beta: Number(beta.toFixed(3)),
      sharpe: Number(sharpe.toFixed(3)),
      correlationMatrix: corrMatrix,
      stressTests: stressResults,
      symbols,
    });
  } catch (error) {
    console.error('Risk calc error:', error);
    return NextResponse.json({ error: 'Calculation failed' }, { status: 500 });
  }
}
