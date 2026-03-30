import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

// Sector representative stocks — used to compute sector performance
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

interface QuoteData {
  symbol: string;
  name: string;
  price: number;
  changePercentage: number;
  change: number;
  marketCap: number;
}

async function fetchQuote(symbol: string): Promise<QuoteData | null> {
  try {
    const res = await fetch(`${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as QuoteData;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) return NextResponse.json({ sectors: [], stocks: [] });

    const type = req.nextUrl.searchParams.get('type');
    const sector = req.nextUrl.searchParams.get('sector');

    if (type === 'stocks' && sector) {
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

    // Fetch one representative stock per sector to compute performance
    const sectorEntries = Object.entries(SECTOR_REPS);
    const repQuotes = await Promise.all(
      sectorEntries.map(([, stocks]) => fetchQuote(stocks[0]))
    );

    const sectors = sectorEntries.map(([sectorName], i) => ({
      sector: sectorName,
      changesPercentage: repQuotes[i]?.changePercentage?.toFixed(2) || '0.00',
    }));

    return NextResponse.json({ sectors });
  } catch (error) {
    console.error('Sectors error:', error);
    return NextResponse.json({ sectors: [], stocks: [] });
  }
}
