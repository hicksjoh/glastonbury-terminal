import { NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercentage: number;
}

const TICKER_SYMBOLS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^DJI', label: 'DOW' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^VIX', label: 'VIX' },
  { symbol: 'GCUSD', label: 'GOLD' },
  { symbol: 'BTCUSD', label: 'BTC' },
];

export async function GET() {
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ tickers: [] });
    }

    const results = await Promise.all(
      TICKER_SYMBOLS.map(async ({ symbol, label }) => {
        try {
          const res = await fetch(
            `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
            { next: { revalidate: 60 } }
          );
          if (!res.ok) return null;
          const data: FMPQuote[] = await res.json();
          if (!Array.isArray(data) || data.length === 0) return null;
          const quote = data[0];
          return {
            symbol,
            label,
            price: quote.price || 0,
            change: quote.change || 0,
            changePercent: quote.changePercentage || 0,
          };
        } catch {
          return null;
        }
      })
    );

    return NextResponse.json({ tickers: results.filter(Boolean) });
  } catch (error) {
    console.error('Market ticker error:', error);
    return NextResponse.json({ tickers: [] });
  }
}
