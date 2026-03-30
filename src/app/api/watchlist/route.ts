import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  try {
    const symbols = req.nextUrl.searchParams.get('symbols') || '';
    if (!symbols || !FMP_KEY) {
      return NextResponse.json({ quotes: [] });
    }

    const res = await fetch(`${FMP_BASE}/quote/${symbols}?apikey=${FMP_KEY}`);
    if (!res.ok) {
      return NextResponse.json({ quotes: [] });
    }

    const data = await res.json();
    const quotes = (data || []).map((q: Record<string, unknown>) => ({
      symbol: q.symbol,
      name: q.name,
      price: q.price,
      change: q.change,
      changePercent: q.changesPercentage,
      volume: q.volume,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
      yearHigh: q.yearHigh,
      yearLow: q.yearLow,
      pe: q.pe,
      marketCap: q.marketCap,
    }));

    return NextResponse.json({ quotes });
  } catch (error) {
    console.error('Watchlist error:', error);
    return NextResponse.json({ quotes: [] });
  }
}
