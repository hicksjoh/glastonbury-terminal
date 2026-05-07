import { NextRequest, NextResponse } from 'next/server';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import {
  getSectorPerformance as getSectorPerformanceStable,
  getQuote,
} from '@/lib/fmp-client';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// NOTE: FMP retired all /api/v3 endpoints for this account tier as of
// Aug 31 2025 (they return 403 "Legacy Endpoint"). Quote calls are routed
// through the /stable client (src/lib/fmp-client.ts). The sector
// screener no longer has a /stable equivalent — we fall through to the
// representative-stocks path below when `fetchSectorStocksViaScreener`
// returns empty.
const FMP_KEY = process.env.FMP_API_KEY || '';

// Sector representative stocks — used for drill-down and fallback performance
const SECTOR_REPS: Record<string, string[]> = {
  'Technology': ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META'],
  'Healthcare': ['UNH', 'JNJ', 'PFE', 'ABBV'],
  'Financial Services': ['JPM', 'BAC', 'GS'],
  'Consumer Cyclical': ['AMZN', 'TSLA', 'NKE'],
  'Communication Services': ['DIS', 'NFLX', 'T'],
  'Industrials': ['BA', 'GE'],
  'Consumer Defensive': ['KO', 'PEP', 'WMT', 'COST'],
  'Energy': ['XOM', 'CVX'],
};

// Map FMP sector names to our display names
const SECTOR_NAME_MAP: Record<string, string> = {
  'Technology': 'Technology',
  'Healthcare': 'Healthcare',
  'Financial Services': 'Financial Services',
  'Consumer Cyclical': 'Consumer Cyclical',
  'Communication Services': 'Communication Services',
  'Industrials': 'Industrials',
  'Consumer Defensive': 'Consumer Defensive',
  'Energy': 'Energy',
  'Real Estate': 'Real Estate',
  'Utilities': 'Utilities',
  'Basic Materials': 'Basic Materials',
};

interface QuoteData {
  symbol: string;
  name: string;
  price: number;
  changePercentage: number;
  changesPercentage?: number;
  change: number;
  marketCap: number;
}

async function fetchQuote(symbol: string): Promise<QuoteData | null> {
  const q = await getQuote(symbol);
  if (!q) return null;
  return {
    symbol: q.symbol,
    name: q.name,
    price: q.price,
    change: q.change,
    changePercentage: q.changePercentage,
    marketCap: q.marketCap,
  };
}

// FMP's /stable tier has no direct stock-screener. Return empty so the
// caller falls through to representative-stocks-per-sector. If we ever
// add Polygon screening this is where it plugs in.
async function fetchSectorStocksViaScreener(_sector: string): Promise<QuoteData[]> {
  return [];
}

async function fetchSectorPerformance(): Promise<{ sector: string; changesPercentage: string }[] | null> {
  const rows = await getSectorPerformanceStable().catch(() => []);
  if (rows.length === 0) return null;
  return rows.map(r => ({
    sector: SECTOR_NAME_MAP[r.sector] || r.sector,
    changesPercentage: r.changesPercentage.toFixed(2),
  }));
}

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'sectors' });
  try {
    if (!FMP_KEY) {
      // Return sectors with 0% and a hint
      const sectors = Object.keys(SECTOR_REPS).map(s => ({
        sector: s,
        changesPercentage: '0.00',
      }));
      return NextResponse.json({ sectors, noKey: true });
    }

    const type = req.nextUrl.searchParams.get('type');
    const sector = req.nextUrl.searchParams.get('sector');

    const cacheKey = `sectors:${type || 'overview'}:${sector || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    if (type === 'stocks' && sector) {
      // Try stock-screener first (single API call for top 5 movers)
      let screenerResults = await fetchSectorStocksViaScreener(sector);

      if (screenerResults.length > 0) {
        const payload = {
          stocks: screenerResults.map(q => ({
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            changesPercentage: q.changePercentage || 0,
            marketCap: q.marketCap,
            sector: sector,
          })),
        };
        setCache(cacheKey, payload, TTL.MEDIUM);
        return NextResponse.json(payload);
      }

      // Fallback: fetch individual quotes for representative stocks
      const sectorStocks = SECTOR_REPS[sector] || [];
      const quotes = await Promise.all(sectorStocks.map(fetchQuote));
      const payload = {
        stocks: quotes
          .filter((q): q is QuoteData => q !== null)
          .map(q => ({
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            changesPercentage: q.changePercentage || 0,
            marketCap: q.marketCap,
            sector: sector,
          })),
      };
      setCache(cacheKey, payload, TTL.MEDIUM);
      return NextResponse.json(payload);
    }

    // Try FMP's dedicated sector performance endpoint first
    const sectorPerf = await fetchSectorPerformance();
    if (sectorPerf && sectorPerf.length > 0) {
      const payload = { sectors: sectorPerf };
      setCache(cacheKey, payload, TTL.MEDIUM);
      return NextResponse.json(payload);
    }

    // Fallback: average performance of representative stocks per sector
    const sectorEntries = Object.entries(SECTOR_REPS);
    const allQuotes = await Promise.all(
      sectorEntries.map(async ([, stocks]) => {
        const quotes = await Promise.all(stocks.slice(0, 3).map(fetchQuote));
        return quotes.filter((q): q is QuoteData => q !== null);
      })
    );

    const sectors = sectorEntries.map(([sectorName], i) => {
      const quotes = allQuotes[i];
      if (quotes.length === 0) return { sector: sectorName, changesPercentage: '0.00' };
      const avg = quotes.reduce((sum, q) => sum + (q.changePercentage || 0), 0) / quotes.length;
      return { sector: sectorName, changesPercentage: avg.toFixed(2) };
    });

    const payload = { sectors };
    setCache(cacheKey, payload, TTL.MEDIUM);
    return NextResponse.json(payload);
  } catch (error) {
    // Sectors degrades gracefully — return empty payload rather than 5xx
    // so the dashboard tile doesn't break. Still capture the upstream
    // failure so we know FMP is down.
    const eventId = captureRouteError(error, { request_id, route: 'sectors' });
    log.warn({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'sectors fallthrough — returning empty');
    return NextResponse.json({ sectors: [], stocks: [] });
  }
}
