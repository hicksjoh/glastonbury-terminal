import { NextRequest, NextResponse } from 'next/server';
import { log as baseLog } from '@/lib/logger';

const priceLog = baseLog.child({ component: 'prices/stream' });

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY || '';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || '';

const alpacaHeaders: Record<string, string> = {
  'APCA-API-KEY-ID': ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
};

// Symbols that need FMP (indices, crypto, commodities)
const FMP_SYMBOLS = new Set(['^GSPC', '^DJI', '^IXIC', '^VIX', 'GCUSD', 'BTCUSD', 'ETHUSD']);

interface PriceResult {
  price: number;
  change: number;
  changePercent: number;
}

async function fetchAlpacaQuotes(symbols: string[]): Promise<Record<string, PriceResult>> {
  if (symbols.length === 0 || !ALPACA_API_KEY) return {};

  const results: Record<string, PriceResult> = {};

  // Use snapshots endpoint for batch quotes
  try {
    const symbolList = symbols.join(',');
    const res = await fetch(
      `${ALPACA_DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbolList)}`,
      { headers: alpacaHeaders, cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      for (const [symbol, snapshot] of Object.entries(data)) {
        const snap = snapshot as {
          latestTrade?: { p: number };
          dailyBar?: { o: number; c: number };
          prevDailyBar?: { c: number };
        };
        const price = snap.latestTrade?.p || snap.dailyBar?.c || 0;
        const prevClose = snap.prevDailyBar?.c || snap.dailyBar?.o || price;
        const change = price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
        results[symbol] = { price, change, changePercent };
      }
    }
  } catch (err) {
    // Non-fatal — caller falls back to empty object. Just emit a warn so
    // we can detect when Alpaca-side issues cause widespread blank tiles.
    priceLog.warn(
      { err: err instanceof Error ? err.message : String(err), batch_size: symbols.length },
      'alpaca batch quote failed',
    );
  }

  return results;
}

async function fetchFMPQuotes(symbols: string[]): Promise<Record<string, PriceResult>> {
  if (symbols.length === 0 || !FMP_KEY) return {};

  const results: Record<string, PriceResult> = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetch(
          `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const q = data[0];
          results[symbol] = {
            price: q.price || 0,
            change: q.change || 0,
            changePercent: q.changePercentage || 0,
          };
        }
      } catch {
        // Skip failed symbols
      }
    })
  );

  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get('symbols') || '';
  const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  // Split symbols between Alpaca (stocks) and FMP (indices/crypto)
  const fmpSymbols = symbols.filter(s => FMP_SYMBOLS.has(s));
  const alpacaSymbols = symbols.filter(s => !FMP_SYMBOLS.has(s));

  // Fetch in parallel
  const [alpacaPrices, fmpPrices] = await Promise.all([
    fetchAlpacaQuotes(alpacaSymbols),
    fetchFMPQuotes(fmpSymbols),
  ]);

  const prices = { ...alpacaPrices, ...fmpPrices };

  return NextResponse.json(
    { prices, timestamp: Date.now() },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
}
