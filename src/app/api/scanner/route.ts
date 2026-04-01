import { NextRequest, NextResponse } from 'next/server';
import { scoreSignal } from '@/lib/signal-scorer';

const FMP_KEY = process.env.FMP_API_KEY;

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const preset = req.nextUrl.searchParams.get('preset') || 'confluence';

    let signals: SignalResult[] = [];

    switch (preset) {
      case 'momentum':
        signals = await scanMomentum();
        break;
      case 'value':
        signals = await scanValue();
        break;
      case 'income':
        signals = await scanIncome();
        break;
      case 'confluence':
      default:
        signals = await scanConfluence();
        break;
    }

    // Get market regime from gainers/losers ratio
    const regime = await getMarketRegime();

    return NextResponse.json({
      signals: signals.slice(0, 15),
      preset,
      timestamp: new Date().toISOString(),
      marketRegime: regime,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface SignalResult {
  symbol: string;
  company: string;
  score: number;
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number } | null;
  thesis: string;
  regime_fit: boolean;
}

async function scanMomentum(): Promise<SignalResult[]> {
  const res = await fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${FMP_KEY}`);
  const gainers = res.ok ? await res.json() : [];
  if (!Array.isArray(gainers)) return [];

  return gainers.slice(0, 15).map((g: Record<string, unknown>) => {
    const change = Number(g.changesPercentage || 0);
    const result = scoreSignal({
      above50DMA: change > 5,
      bullishFlow: change > 8,
      regimeFit: true,
      winRate: 0.55,
      avgWin: 0.08,
      avgLoss: 0.04,
    }, 100000, Number(g.price || 100));

    return {
      symbol: String(g.symbol || ''),
      company: String(g.name || g.symbol || ''),
      score: result.score,
      sources: [...result.sources, 'momentum'],
      kellySizing: result.kellySizing,
      thesis: `Up ${change.toFixed(1)}% — momentum breakout with strong volume`,
      regime_fit: true,
    };
  });
}

async function scanValue(): Promise<SignalResult[]> {
  const res = await fetch(
    `https://financialmodelingprep.com/api/v3/stock-screener?marketCapMoreThan=1000000000&priceMoreThan=5&volumeMoreThan=500000&apikey=${FMP_KEY}`
  );
  const stocks = res.ok ? await res.json() : [];
  if (!Array.isArray(stocks)) return [];

  return stocks
    .filter((s: Record<string, unknown>) => {
      const pe = Number(s.pe || 999);
      return pe > 0 && pe < 15;
    })
    .slice(0, 15)
    .map((s: Record<string, unknown>) => {
      const result = scoreSignal({
        sentimentScore: 7,
        regimeFit: true,
        winRate: 0.6,
        avgWin: 0.12,
        avgLoss: 0.06,
      }, 100000, Number(s.price || 100));

      return {
        symbol: String(s.symbol || ''),
        company: String(s.companyName || s.symbol || ''),
        score: result.score,
        sources: [...result.sources, 'value_screen'],
        kellySizing: result.kellySizing,
        thesis: `P/E ${Number(s.pe || 0).toFixed(1)} — undervalued relative to sector`,
        regime_fit: true,
      };
    });
}

async function scanIncome(): Promise<SignalResult[]> {
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const res = await fetch(
    `https://financialmodelingprep.com/api/v3/stock_dividend_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`
  );
  const dividends = res.ok ? await res.json() : [];
  if (!Array.isArray(dividends)) return [];

  return dividends
    .filter((d: Record<string, unknown>) => Number(d.yield || 0) > 3)
    .slice(0, 15)
    .map((d: Record<string, unknown>) => {
      const yld = Number(d.yield || 0);
      const result = scoreSignal({
        sentimentScore: 7,
        regimeFit: true,
        winRate: 0.65,
        avgWin: 0.06,
        avgLoss: 0.03,
      }, 100000, Number(d.adjDividend || 1) * 50);

      return {
        symbol: String(d.symbol || ''),
        company: String(d.symbol || ''),
        score: Math.min(100, result.score + Math.round(yld * 3)),
        sources: [...result.sources, 'dividend_income'],
        kellySizing: result.kellySizing,
        thesis: `${yld.toFixed(1)}% yield — ex-div ${d.date || 'upcoming'}`,
        regime_fit: true,
      };
    });
}

async function scanConfluence(): Promise<SignalResult[]> {
  // Cross-reference multiple signal sources
  const [gainersRes, activesRes, insiderRes] = await Promise.all([
    fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${FMP_KEY}`),
    fetch(`https://financialmodelingprep.com/api/v3/stock_market/actives?apikey=${FMP_KEY}`),
    fetch(`https://financialmodelingprep.com/api/v4/insider-trading-rss-feed?limit=50&apikey=${FMP_KEY}`).catch(() => null),
  ]);

  const gainers = gainersRes.ok ? await gainersRes.json() : [];
  const actives = activesRes.ok ? await activesRes.json() : [];
  const insiders = insiderRes?.ok ? await insiderRes.json() : [];

  // Build symbol map
  const symbolData: Record<string, {
    price: number; change: number; volume: number;
    isGainer: boolean; isActive: boolean; hasInsider: boolean; insiderBuy: boolean;
  }> = {};

  if (Array.isArray(gainers)) {
    for (const g of gainers.slice(0, 20)) {
      symbolData[g.symbol] = {
        price: g.price || 0, change: g.changesPercentage || 0,
        volume: g.volume || 0, isGainer: true, isActive: false,
        hasInsider: false, insiderBuy: false,
      };
    }
  }

  if (Array.isArray(actives)) {
    for (const a of actives.slice(0, 20)) {
      if (symbolData[a.symbol]) {
        symbolData[a.symbol].isActive = true;
      } else {
        symbolData[a.symbol] = {
          price: a.price || 0, change: a.changesPercentage || 0,
          volume: a.volume || 0, isGainer: false, isActive: true,
          hasInsider: false, insiderBuy: false,
        };
      }
    }
  }

  if (Array.isArray(insiders)) {
    for (const ins of insiders) {
      const sym = ins.symbol;
      if (sym && symbolData[sym]) {
        symbolData[sym].hasInsider = true;
        if (String(ins.acquistionOrDisposition || '').toLowerCase() === 'a') {
          symbolData[sym].insiderBuy = true;
        }
      }
    }
  }

  // Score each symbol
  const results: SignalResult[] = [];
  for (const [symbol, data] of Object.entries(symbolData)) {
    const result = scoreSignal({
      insiderClusterBuy: data.insiderBuy,
      bullishFlow: data.isGainer && data.change > 5,
      sentimentScore: data.change > 3 ? 8 : data.change > 0 ? 6 : 4,
      above50DMA: data.change > 0,
      regimeFit: true,
      winRate: 0.55,
      avgWin: 0.08,
      avgLoss: 0.05,
    }, 100000, data.price);

    if (result.score >= 20) {
      results.push({
        symbol,
        company: symbol,
        score: result.score,
        sources: result.sources,
        kellySizing: result.kellySizing,
        thesis: generateThesis(symbol, data, result.sources),
        regime_fit: true,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 15);
}

function generateThesis(
  symbol: string,
  data: { change: number; isGainer: boolean; isActive: boolean; insiderBuy: boolean },
  sources: string[]
): string {
  const parts = [];
  if (data.isGainer) parts.push(`+${data.change.toFixed(1)}% today`);
  if (data.isActive) parts.push('high volume');
  if (data.insiderBuy) parts.push('insider buying');
  if (sources.includes('positive_sentiment')) parts.push('positive sentiment');
  return `${symbol}: ${parts.join(', ')}. ${sources.length} confluence signals detected.`;
}

async function getMarketRegime(): Promise<string> {
  try {
    const res = await fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${FMP_KEY}`);
    const gainers = res.ok ? await res.json() : [];
    const losersRes = await fetch(`https://financialmodelingprep.com/api/v3/stock_market/losers?apikey=${FMP_KEY}`);
    const losers = losersRes.ok ? await losersRes.json() : [];

    const gLen = Array.isArray(gainers) ? gainers.length : 0;
    const lLen = Array.isArray(losers) ? losers.length : 0;

    if (gLen > lLen * 1.5) return 'bull_low_vol';
    if (gLen > lLen) return 'bull_high_vol';
    if (lLen > gLen * 1.5) return 'bear_high_vol';
    return 'bear_low_vol';
  } catch {
    return 'unknown';
  }
}
