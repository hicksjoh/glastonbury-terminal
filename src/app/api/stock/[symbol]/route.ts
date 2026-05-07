import { NextRequest, NextResponse } from 'next/server';
import { validateEquitySymbol } from '@/lib/sanitize';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';
const ALPACA_DATA = 'https://data.alpaca.markets';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

function getStartDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0] + 'T00:00:00Z';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol: rawSymbol } = await params;
    // p6-5: strict equity-symbol validation. Path-traversal / unicode
    // attacks via the dynamic [symbol] segment can no longer reach FMP
    // or Alpaca URLs.
    const symbol = validateEquitySymbol(rawSymbol);
    if (!symbol) {
      return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
    }
    const encoded = encodeURIComponent(symbol);
    const range = req.nextUrl.searchParams.get('range') || '3M';

    const [profileRes, quoteRes, newsRes] = await Promise.all([
      FMP_KEY ? fetch(`${FMP_BASE}/profile?symbol=${encoded}&apikey=${FMP_KEY}`) : null,
      FMP_KEY ? fetch(`${FMP_BASE}/quote?symbol=${encoded}&apikey=${FMP_KEY}`) : null,
      fetch(`${ALPACA_DATA}/v1beta1/news?symbols=${encoded}&limit=10&sort=desc`, { headers: alpacaHeaders }),
    ]);

    const profile = profileRes?.ok ? ((await profileRes.json()) as Record<string, unknown>[])[0] || null : null;
    const quoteData = quoteRes?.ok ? ((await quoteRes.json()) as Record<string, unknown>[]) : [];
    const quote = quoteData.length > 0 ? quoteData[0] : null;
    const newsData = newsRes?.ok ? await newsRes.json() : { news: [] };

    let historicalPrices: { time: string; open: number; high: number; low: number; close: number; volume: number }[] = [];

    const rangeConfig: Record<string, { timeframe: string; start: string; feed: string }> = {
      '1D': { timeframe: '5Min', start: getStartDate(1), feed: 'iex' },
      '1W': { timeframe: '1Hour', start: getStartDate(7), feed: 'iex' },
      '1M': { timeframe: '1Day', start: getStartDate(30), feed: 'sip' },
      '3M': { timeframe: '1Day', start: getStartDate(90), feed: 'sip' },
      '6M': { timeframe: '1Day', start: getStartDate(180), feed: 'sip' },
      '1Y': { timeframe: '1Day', start: getStartDate(365), feed: 'sip' },
      '5Y': { timeframe: '1Week', start: getStartDate(365 * 5), feed: 'sip' },
      'ALL': { timeframe: '1Week', start: getStartDate(365 * 20), feed: 'sip' },
    };

    const config = rangeConfig[range] || rangeConfig['3M'];

    try {
      const barsRes = await fetch(
        `${ALPACA_DATA}/v2/stocks/${encoded}/bars?timeframe=${config.timeframe}&start=${encodeURIComponent(config.start)}&feed=${config.feed}&limit=1000&sort=asc`,
        { headers: alpacaHeaders }
      );
      if (barsRes.ok) {
        const barsData = await barsRes.json();
        historicalPrices = (barsData.bars || []).map((b: { t: string; o: number; h: number; l: number; c: number; v: number }) => ({
          time: range === '1D'
            ? Math.floor(new Date(b.t).getTime() / 1000).toString()
            : b.t.split('T')[0],
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }));
      }
    } catch (err) {
      console.error('Bars fetch error:', err);
    }

    return NextResponse.json({
      profile,
      quote,
      historicalPrices,
      news: (newsData.news || []).map((n: Record<string, unknown>) => ({
        headline: n.headline,
        source: n.source,
        url: n.url,
        created_at: n.created_at,
        symbols: n.symbols || [],
      })),
    });
  } catch (error) {
    console.error('Stock detail error:', error);
    return NextResponse.json({ profile: null, quote: null, historicalPrices: [], news: [] });
  }
}
