import { NextResponse } from 'next/server';
import { getCached, setCache, TTL } from '@/lib/server-cache';

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

    const cacheKey = 'market-ticker';
    const cached = getCached<{ tickers: unknown[] }>(cacheKey);
    if (cached) return NextResponse.json(cached);

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

    const payload = { tickers: results.filter(Boolean) };
    // 2 minutes instead of 10s — FMP free tier can't sustain 6 calls/10s
    // across a long-lived dashboard. Prices are stale by max 2 min, which
    // is fine for a non-HFT use case, and it drops our call rate ~12x.
    setCache(cacheKey, payload, 120 * 1000);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Market ticker error:', error);
    return NextResponse.json({ tickers: [] });
  }
}
