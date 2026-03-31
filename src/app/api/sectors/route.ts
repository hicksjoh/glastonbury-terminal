import { NextRequest, NextResponse } from 'next/server';

const FMP_V3 = 'https://financialmodelingprep.com/api/v3';
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
  try {
    const res = await fetch(
      `${FMP_V3}/quote/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const q = data[0];
    return { ...q, changePercentage: q.changePercentage ?? q.changesPercentage ?? 0 } as QuoteData;
  } catch {
    return null;
  }
}

async function fetchSectorStocksViaScreener(sector: string): Promise<QuoteData[]> {
  try {
    const res = await fetch(
      `${FMP_V3}/stock-screener?sector=${encodeURIComponent(sector)}&limit=5&sort=changesPercentage&order=desc&apikey=${FMP_KEY}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: Record<string, unknown>) => ({
      symbol: d.symbol as string,
      name: (d.companyName || d.name || '') as string,
      price: (d.price || 0) as number,
      changePercentage: ((d.changePercentage ?? d.changesPercentage ?? 0) as number),
      changesPercentage: ((d.changesPercentage ?? d.changePercentage ?? 0) as number),
      change: (d.change || 0) as number,
      marketCap: (d.marketCap || 0) as number,
    }));
  } catch {
    return [];
  }
}

async function fetchSectorPerformance(): Promise<{ sector: string; changesPercentage: string }[] | null> {
  try {
    const res = await fetch(`${FMP_V3}/sectors-performance?apikey=${FMP_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data
      .filter((d: { sector: string; changesPercentage: string }) => d.sector && d.changesPercentage)
      .map((d: { sector: string; changesPercentage: string }) => ({
        sector: SECTOR_NAME_MAP[d.sector] || d.sector,
        changesPercentage: parseFloat(d.changesPercentage).toFixed(2),
      }));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
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

    if (type === 'stocks' && sector) {
      // Try stock-screener first (single API call for top 5 movers)
      let screenerResults = await fetchSectorStocksViaScreener(sector);

      if (screenerResults.length > 0) {
        return NextResponse.json({
          stocks: screenerResults.map(q => ({
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            changesPercentage: q.changePercentage || 0,
            marketCap: q.marketCap,
            sector: sector,
          })),
        });
      }

      // Fallback: fetch individual quotes for representative stocks
      const sectorStocks = SECTOR_REPS[sector] || [];
      const quotes = await Promise.all(sectorStocks.map(fetchQuote));
      return NextResponse.json({
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
      });
    }

    // Try FMP's dedicated sector performance endpoint first
    const sectorPerf = await fetchSectorPerformance();
    if (sectorPerf && sectorPerf.length > 0) {
      return NextResponse.json({ sectors: sectorPerf });
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

    return NextResponse.json({ sectors });
  } catch (error) {
    console.error('Sectors error:', error);
    return NextResponse.json({ sectors: [], stocks: [] });
  }
}
