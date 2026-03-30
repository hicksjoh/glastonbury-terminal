import { NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY = process.env.FMP_API_KEY || '';

interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changesPercentage: number;
}

export async function GET() {
  try {
    const symbols = [
      '^GSPC',
      '^DJI',
      '^IXIC',
      '^VIX',
      '^TNX',
      'GC=F',
      'CL=F',
      'BTC-USD',
    ];

    const labelMap: Record<string, string> = {
      '^GSPC': 'S&P 500',
      '^DJI': 'DOW',
      '^IXIC': 'NASDAQ',
      '^VIX': 'VIX',
      '^TNX': '10Y',
      'GC=F': 'GOLD',
      'CL=F': 'OIL',
      'BTC-USD': 'BTC',
    };

    if (!FMP_KEY) {
      return NextResponse.json({ tickers: [] });
    }

    const res = await fetch(
      `${FMP_BASE}/quote/${symbols.join(',')}?apikey=${FMP_KEY}`,
      { next: { revalidate: 60 } }
    );

    if (!res.ok) {
      console.error('FMP ticker error:', res.status);
      return NextResponse.json({ tickers: [] });
    }

    const data: FMPQuote[] = await res.json();

    const tickers = symbols
      .map(sym => {
        const quote = data.find(d => d.symbol === sym);
        if (!quote) return null;
        return {
          symbol: sym,
          label: labelMap[sym] || sym,
          price: quote.price || 0,
          change: quote.change || 0,
          changePercent: quote.changesPercentage || 0,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ tickers });
  } catch (error) {
    console.error('Market ticker error:', error);
    return NextResponse.json({ tickers: [] });
  }
}
