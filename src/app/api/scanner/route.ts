import { NextRequest, NextResponse } from 'next/server';
import {
  confluenceEvidence,
  isScannableMover,
  longSignalFitsRegime,
  type MoverFacts,
} from '@/lib/scanner-evidence';
import { internalFetch } from '@/lib/internal-fetch';
import {
  getMarketGainers,
  getMarketActives,
  getStockScreener,
  getDividendCalendar,
  getLatestInsiderTrades,
  type StockMoverRow,
  type StockScreenerRow,
  type DividendCalendarRow,
  type InsiderTradingRow,
} from '@/lib/fmp-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

interface SignalResult {
  symbol: string;
  company: string;
  score: number;
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number } | null;
  thesis: string;
  regime_fit: boolean;
}

// FMP migration (P0-1): /v3 and /v4 paths now 403. All FMP traffic flows
// through src/lib/fmp-client.ts /stable wrappers. Each helper here returns
// `{ rows, meta }` so the route can build a single `_meta` payload.
type FmpResult<T> = { rows: T[]; meta: ApiMeta };

function fmpMeta(rows: unknown[]): ApiMeta {
  return buildMeta({ source: 'fmp', live: rows.length > 0 });
}

async function fetchGainers(): Promise<FmpResult<StockMoverRow>> {
  const rows = await getMarketGainers();
  return { rows, meta: fmpMeta(rows) };
}

async function fetchActives(): Promise<FmpResult<StockMoverRow>> {
  const rows = await getMarketActives();
  return { rows, meta: fmpMeta(rows) };
}

async function fetchInsiderFeed(): Promise<FmpResult<InsiderTradingRow>> {
  const rows = await getLatestInsiderTrades(50);
  return { rows, meta: fmpMeta(rows) };
}

async function GET_impl(req: NextRequest) {
  try {
    const preset = req.nextUrl.searchParams.get('preset') || 'confluence';
    let signals: SignalResult[] = [];
    let metas: ApiMeta[] = [];

    // Regime first: each preset's regime_fit badge is derived from it.
    const { regime, regimeMeta } = await getMarketRegime();

    switch (preset) {
      case 'momentum':
        ({ signals, metas } = await scanMomentum(regime));
        break;
      case 'value':
        ({ signals, metas } = await scanValue(regime));
        break;
      case 'income':
        ({ signals, metas } = await scanIncome(regime));
        break;
      case 'confluence':
      default:
        ({ signals, metas } = await scanConfluence(regime));
        break;
    }

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

async function scanMomentum(regime: string): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const result = await fetchGainers();

  const signals = result.rows
    .map(g => ({ g, price: Number(g.price || 0), change: Number(g.changesPercentage || 0) }))
    .filter(isScannableMover)
    .slice(0, 15)
    .map(({ g, change }) => ({
      symbol: String(g.symbol || ''),
      company: String(g.name || g.symbol || ''),
      score: Math.min(100, Math.round(30 + change * 2)),
      sources: ['top_gainer'],
      kellySizing: null,
      thesis: `Up ${change.toFixed(1)}% today — on the top-gainers list. Price action only; no flow or sentiment check.`,
      regime_fit: longSignalFitsRegime(regime),
    }));

  return { signals, metas: [result.meta] };
}

async function scanValue(regime: string): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const stocks: StockScreenerRow[] = await getStockScreener({
    marketCapMoreThan: 1_000_000_000,
    priceMoreThan: 5,
    volumeMoreThan: 500_000,
  });

  const signals = stocks
    .filter(s => {
      const pe = Number(s.pe);
      return Number.isFinite(pe) && pe > 0 && pe < 15;
    })
    .slice(0, 15)
    .map(s => {
      const pe = Number(s.pe);
      return {
        symbol: String(s.symbol || ''),
        company: String(s.companyName || s.symbol || ''),
        score: Math.max(0, Math.min(100, Math.round(100 - pe * 4))),
        sources: ['value_screen'],
        kellySizing: null,
        thesis: `P/E ${pe.toFixed(1)} — passes the P/E < 15, $1B+ cap screen. Not compared against its sector.`,
        regime_fit: longSignalFitsRegime(regime),
      };
    });

  return { signals, metas: [fmpMeta(stocks)] };
}

async function scanIncome(regime: string): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const dividends: DividendCalendarRow[] = await getDividendCalendar(from, to);

  const signals = dividends
    .filter(d => Number(d.yield || 0) > 3)
    .slice(0, 15)
    .map(d => {
      const yld = Number(d.yield || 0);
      return {
        symbol: String(d.symbol || ''),
        company: String(d.symbol || ''),
        score: Math.min(100, Math.round(yld * 10)),
        sources: ['dividend_income'],
        kellySizing: null,
        thesis: `${yld.toFixed(1)}% yield — ex-div ${d.date || 'upcoming'}`,
        regime_fit: longSignalFitsRegime(regime),
      };
    });

  return { signals, metas: [fmpMeta(dividends)] };
}

async function scanConfluence(regime: string): Promise<{ signals: SignalResult[]; metas: ApiMeta[] }> {
  const [gainersRes, activesRes, insiderRes] = await Promise.all([
    fetchGainers(),
    fetchActives(),
    fetchInsiderFeed(),
  ]);

  const symbolData: Record<string, MoverFacts> = {};

  for (const g of gainersRes.rows.slice(0, 20)) {
    if (!g.symbol) continue;
    symbolData[g.symbol] = {
      price: Number(g.price || 0), change: Number(g.changesPercentage || 0),
      isGainer: true, isActive: false, insiderBuy: false,
    };
  }

  for (const a of activesRes.rows.slice(0, 20)) {
    if (!a.symbol) continue;
    if (symbolData[a.symbol]) {
      symbolData[a.symbol].isActive = true;
    } else {
      symbolData[a.symbol] = {
        price: Number(a.price || 0), change: Number(a.changesPercentage || 0),
        isGainer: false, isActive: true, insiderBuy: false,
      };
    }
  }

  for (const ins of insiderRes.rows) {
    const sym = ins.symbol;
    if (sym && symbolData[sym] && String(ins.acquistionOrDisposition || '').toLowerCase() === 'a') {
      symbolData[sym].insiderBuy = true;
    }
  }

  const results: SignalResult[] = [];
  for (const [symbol, facts] of Object.entries(symbolData)) {
    if (!isScannableMover(facts)) continue;
    const { score, sources } = confluenceEvidence(facts);
    if (sources.length === 0) continue;
    results.push({
      symbol,
      company: symbol,
      score,
      sources,
      kellySizing: null,
      thesis: generateThesis(symbol, facts, sources),
      regime_fit: longSignalFitsRegime(regime),
    });
  }

  return {
    signals: results.sort((a, b) => b.score - a.score).slice(0, 15),
    metas: [gainersRes.meta, activesRes.meta, insiderRes.meta],
  };
}

function generateThesis(symbol: string, facts: MoverFacts, sources: string[]): string {
  const parts = [];
  if (facts.isGainer) parts.push(`+${facts.change.toFixed(1)}% today`);
  if (facts.isActive) parts.push('on the most-active list');
  if (facts.insiderBuy) parts.push('recent insider buy');
  return `${symbol}: ${parts.join(', ')}. ${sources.length} of 3 checks matched.`;
}

/** Reads /api/regime — the row the header chip shows — rather than classifying
 *  again, so the two chips agree even inside that route's one-hour cache. */
async function getMarketRegime(): Promise<{ regime: string; regimeMeta: ApiMeta }> {
  try {
    const res = await internalFetch('/api/regime', { signal: AbortSignal.timeout(10000) });
    const body = res.ok ? await res.json() : null;
    const regime: string = body?.success && body.data?.regime ? body.data.regime : 'unknown';
    return {
      regime,
      regimeMeta: buildMeta(
        regime === 'unknown'
          ? { source: 'fallback:regime', live: false, error: 'regime unavailable' }
          : { source: 'regime', live: true },
      ),
    };
  } catch {
    return {
      regime: 'unknown',
      regimeMeta: buildMeta({ source: 'fallback:regime', live: false, error: 'regime fetch failed' }),
    };
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('scanner', RATE.UPSTREAM, GET_impl);
