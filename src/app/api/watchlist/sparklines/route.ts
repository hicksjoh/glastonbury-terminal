import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(req: NextRequest) {
  try {
    const symbols = req.nextUrl.searchParams.get('symbols') || '';
    if (!symbols || !FMP_KEY) {
      return NextResponse.json({ sparklines: {} });
    }

    const symbolList = symbols.split(',').filter(Boolean).slice(0, 20);
    const sparklines: Record<string, number[]> = {};

    await Promise.all(
      symbolList.map(async (sym) => {
        try {
          const res = await fetch(
            `${FMP_BASE}/historical-price-eod/light?symbol=${encodeURIComponent(sym.trim())}&from=${getDateNDaysAgo(10)}&to=${getToday()}&apikey=${FMP_KEY}`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            // FMP returns most recent first, reverse for chronological
            sparklines[sym.trim()] = data
              .slice(0, 7)
              .reverse()
              .map((d: { close: number }) => d.close);
          }
        } catch {
          // skip this symbol
        }
      })
    );

    return NextResponse.json({ sparklines });
  } catch (error) {
    console.error('Sparklines error:', error);
    return NextResponse.json({ sparklines: {} });
  }
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
