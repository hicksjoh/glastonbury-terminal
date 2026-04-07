import { NextRequest, NextResponse } from 'next/server';
import { scoreSignal } from '@/lib/signal-scorer';
import { apiFetchWithFallback, type ApiResult } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

interface SignalResult {
  symbol: string;
  company: string;
  score: number;
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number } | null;
  thesis: string;
  regime_fit: boolean;
}

interface StockQuote {
  symbol: string;
  name?: string;
  companyName?: string;
  price: number;
  changesPercentage?: number;
  change?: number;
  volume?: number;
  pe?: number;
  [key: string]: unknown;
}

interface InsiderTrade {
  symbol: string;
  acquistionOrDisposition?: string;
  [key: string]: unknown;
}

interface DividendEntry {
  symbol: string;
  yield?: number;
  date?: string;
  adjDividend?: number;
  [key: string]: unknown;
}

// Shared FMP fetchers using centralized client
async function fetchGainers(): Promise<ApiResult<StockQuote[]>> {
  return apiFetchWithFallback<StockQuote[]>(
    'fmp', '/v3/stock_market/gainers', {}, [],
    { cacheTtlMs: 5 * 60 * 1000 },
  );
}

async function fetchActives(): Promise<ApiResult<StockQuote[]>> {
  return apiFetchWithFallback<StockQuote[]>(
    'fmp', '/v3/stock_market/actives', {}, [],
    { cacheTtlMs: 5 * 60 * 1000 },
  );
}

async function fetchLosers(): Promise<ApiResult<StockQuote[]>> {
  return apiFetchWithFallback<StockQuote[]>(
    'fmp', '/v3/stock_market/losers', {}, [],
    { cacheTtlMs: 5 * 60 * 1000 },
  );
}

async function fetchInsiderFeed(): Promise<ApiResult<InsiderTrade[]>> {
  return apiFetchWithFallback<InsiderTrade[]>(
    'fmp', '/v4/insider-trading-rss-feed', { limit: '50' }, [],
    { cacheTtlMs: 15 * 60 * 1000 },
  );
}

export async function GET(req: NextRequest) {
  try {
    const preset = req.nextUrl.searchParams.get('preset') || 'confluence';
    let signals: SignalResult[] = [];
    let metas: ApiMeta[] = [];

    switch (preset) {
      case 'momentum':
        ({ signals, metas } = await scanMomentum());
        break;
      case 'value':
        ({ signals, metas } = await scanValue());
        break;
      case 'income':
        ({ signals, metas } = await scanIncome());
        break;
      case 'confluence':
      default:
        ({ signals, metas } = await scanConfluence());
        break;
    }

    const { regime, regimeMeta } = await getMarketRegime();
    metas.push(regimeMeta);

    const allLive = metas.every(m => m.live);

    return NextResponse.json({
      signals: signals.slice(0, 15),
      preset,
      timestamp: new Date().toISOString(),
      marketRegime: regime,
      _meta: buildMeta({
        source: 'fmp',
        live: allLive,
        cached: metas.some(m => m.cached),
        stale: metas.some(m => m.stale),
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

async function scanMomentum(): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const result = await fetchGainers();
  const gainers = Array.isArray(result.data) ? result.data : [];

  const signals = gainers.slice(0, 15).map(g => {
    const change = Number(g.changesPercentage || 0);
    const scored = scoreSignal({
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
      score: scored.score,
      sources: [...scored.sources, 'momentum'],
      kellySizing: scored.kellySizing,
      thesis: `Up ${change.toFixed(1)}% — momentum breakout with strong volume`,
      regime_fit: true,
    };
  });

  return { signals, metas: [result._meta] };
}

async function scanValue(): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const result = await apiFetchWithFallback<StockQuote[]>(
    'fmp', '/v3/stock-screener',
    { marketCapMoreThan: '1000000000', priceMoreThan: '5', volumeMoreThan: '500000' },
    [],
    { cacheTtlMs: 10 * 60 * 1000 },
  );
  const stocks = Array.isArray(result.data) ? result.data : [];

  const signals = stocks
    .filter(s => {
      const pe = Number(s.pe || 999);
      return pe > 0 && pe < 15;
    })
    .slice(0, 15)
    .map(s => {
      const scored = scoreSignal({
        sentimentScore: 7,
        regimeFit: true,
        winRate: 0.6,
        avgWin: 0.12,
        avgLoss: 0.06,
      }, 100000, Number(s.price || 100));

      return {
        symbol: String(s.symbol || ''),
        company: String(s.companyName || s.symbol || ''),
        score: scored.score,
        sources: [...scored.sources, 'value_screen'],
        kellySizing: scored.kellySizing,
        thesis: `P/E ${Number(s.pe || 0).toFixed(1)} — undervalued relative to sector`,
        regime_fit: true,
      };
    });

  return { signals, metas: [result._meta] };
}

async function scanIncome(): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const result = await apiFetchWithFallback<DividendEntry[]>(
    'fmp', '/v3/stock_dividend_calendar', { from, to }, [],
    { cacheTtlMs: 60 * 60 * 1000 },
  );
  const dividends = Array.isArray(result.data) ? result.data : [];

  const signals = dividends
    .filter(d => Number(d.yield || 0) > 3)
    .slice(0, 15)
    .map(d => {
      const yld = Number(d.yield || 0);
      const scored = scoreSignal({
        sentimentScore: 7,
        regimeFit: true,
        winRate: 0.65,
        avgWin: 0.06,
        avgLoss: 0.03,
      }, 100000, Number(d.adjDividend || 1) * 50);

      return {
        symbol: String(d.symbol || ''),
        company: String(d.symbol || ''),
        score: Math.min(100, scored.score + Math.round(yld * 3)),
        sources: [...scored.sources, 'dividend_income'],
        kellySizing: scored.kellySizing,
        thesis: `${yld.toFixed(1)}% yield — ex-div ${d.date || 'upcoming'}`,
        regime_fit: true,
      };
    });

  return { signals, metas: [result._meta] };
}

async function scanConfluence(): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const [gainersRes, activesRes, insiderRes] = await Promise.all([
    fetchGainers(),
    fetchActives(),
    fetchInsiderFeed(),
  ]);

  const gainers = Array.isArray(gainersRes.data) ? gainersRes.data : [];
  const actives = Array.isArray(activesRes.data) ? activesRes.data : [];
  const insiders = Array.isArray(insiderRes.data) ? insiderRes.data : [];

  const symbolData: Record<string, {
    price: number; change: number; volume: number;
    isGainer: boolean; isActive: boolean; hasInsider: boolean; insiderBuy: boolean;
  }> = {};

  for (const g of gainers.slice(0, 20)) {
    symbolData[g.symbol] = {
      price: g.price || 0, change: Number(g.changesPercentage || 0),
      volume: Number(g.volume || 0), isGainer: true, isActive: false,
      hasInsider: false, insiderBuy: false,
    };
  }

  for (const a of actives.slice(0, 20)) {
    if (symbolData[a.symbol]) {
      symbolData[a.symbol].isActive = true;
    } else {
      symbolData[a.symbol] = {
        price: a.price || 0, change: Number(a.changesPercentage || 0),
        volume: Number(a.volume || 0), isGainer: false, isActive: true,
        hasInsider: false, insiderBuy: false,
      };
    }
  }

  for (const ins of insiders) {
    const sym = ins.symbol;
    if (sym && symbolData[sym]) {
      symbolData[sym].hasInsider = true;
      if (String(ins.acquistionOrDisposition || '').toLowerCase() === 'a') {
        symbolData[sym].insiderBuy = true;
      }
    }
  }

  const results: SignalResult[] = [];
  for (const [symbol, data] of Object.entries(symbolData)) {
    const scored = scoreSignal({
      insiderClusterBuy: data.insiderBuy,
      bullishFlow: data.isGainer && data.change > 5,
      sentimentScore: data.change > 3 ? 8 : data.change > 0 ? 6 : 4,
      above50DMA: data.change > 0,
      regimeFit: true,
      winRate: 0.55,
      avgWin: 0.08,
      avgLoss: 0.05,
    }, 100000, data.price);

    if (scored.score >= 20) {
      results.push({
        symbol,
        company: symbol,
        score: scored.score,
        sources: scored.sources,
        kellySizing: scored.kellySizing,
        thesis: generateThesis(symbol, data, scored.sources),
        regime_fit: true,
      });
    }
  }

  return {
    signals: results.sort((a, b) => b.score - a.score).slice(0, 15),
    metas: [gainersRes._meta, activesRes._meta, insiderRes._meta],
  };
}

function generateThesis(
  symbol: string,
  data: { change: number; isGainer: boolean; isActive: boolean; insiderBuy: boolean },
  sources: string[],
): string {
  const parts = [];
  if (data.isGainer) parts.push(`+${data.change.toFixed(1)}% today`);
  if (data.isActive) parts.push('high volume');
  if (data.insiderBuy) parts.push('insider buying');
  if (sources.includes('positive_sentiment')) parts.push('positive sentiment');
  return `${symbol}: ${parts.join(', ')}. ${sources.length} confluence signals detected.`;
}

async function getMarketRegime(): Promise<{ regime: string; regimeMeta: ApiMeta }> {
  try {
    const [gainersRes, losersRes] = await Promise.all([fetchGainers(), fetchLosers()]);
    const gLen = Array.isArray(gainersRes.data) ? gainersRes.data.length : 0;
    const lLen = Array.isArray(losersRes.data) ? losersRes.data.length : 0;

    let regime: string;
    if (gLen > lLen * 1.5) regime = 'bull_low_vol';
    else if (gLen > lLen) regime = 'bull_high_vol';
    else if (lLen > gLen * 1.5) regime = 'bear_high_vol';
    else regime = 'bear_low_vol';

    return {
      regime,
      regimeMeta: buildMeta({ source: 'fmp', live: gainersRes._meta.live && losersRes._meta.live }),
    };
  } catch {
    return {
      regime: 'unknown',
      regimeMeta: buildMeta({ source: 'fallback:fmp', live: false, error: 'regime fetch failed' }),
    };
  }
}
