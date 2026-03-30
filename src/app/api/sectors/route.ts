import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  try {
    if (!FMP_KEY) return NextResponse.json({ sectors: [], stocks: [] });

    const type = req.nextUrl.searchParams.get('type');

    if (type === 'stocks') {
      const res = await fetch(`${FMP_BASE}/stock-screener?marketCapMoreThan=10000000000&limit=100&apikey=${FMP_KEY}`);
      if (!res.ok) return NextResponse.json({ stocks: [] });
      const data = await res.json();
      return NextResponse.json({
        stocks: (data || []).map((s: Record<string, unknown>) => ({
          symbol: s.symbol,
          name: s.companyName,
          price: s.price,
          changesPercentage: s.changesPercentage || 0,
          marketCap: s.marketCap,
          sector: s.sector,
        })),
      });
    }

    const res = await fetch(`${FMP_BASE}/sector-performance?apikey=${FMP_KEY}`);
    if (!res.ok) return NextResponse.json({ sectors: [] });
    const data = await res.json();

    return NextResponse.json({ sectors: data || [] });
  } catch (error) {
    console.error('Sectors error:', error);
    return NextResponse.json({ sectors: [], stocks: [] });
  }
}
