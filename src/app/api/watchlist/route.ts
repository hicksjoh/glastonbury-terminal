import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  try {
    const symbols = req.nextUrl.searchParams.get('symbols') || '';
    if (!symbols || !FMP_KEY) {
      return NextResponse.json({ quotes: [] });
    }

    const symbolList = symbols.split(',').filter(Boolean);

    const results = await Promise.all(
      symbolList.map(async (sym) => {
        try {
          const res = await fetch(`${FMP_BASE}/quote?symbol=${encodeURIComponent(sym.trim())}&apikey=${FMP_KEY}`);
          if (!res.ok) return null;
          const data = await res.json();
          if (!Array.isArray(data) || data.length === 0) return null;
          const q = data[0] as Record<string, unknown>;
          return {
            symbol: q.symbol,
            name: q.name,
            price: q.price,
            change: q.change,
            changePercent: q.changePercentage,
            volume: q.volume,
            dayHigh: q.dayHigh,
            dayLow: q.dayLow,
            yearHigh: q.yearHigh,
            yearLow: q.yearLow,
            pe: q.pe ?? null,
            marketCap: q.marketCap,
          };
        } catch {
          return null;
        }
      })
    );

    return NextResponse.json({ quotes: results.filter(Boolean) });
  } catch (error) {
    console.error('Watchlist error:', error);
    return NextResponse.json({ quotes: [] });
  }
}
