import { NextRequest, NextResponse } from 'next/server';

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_TRADING_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

// Default symbols to scan
const DEFAULT_SCAN_SYMBOLS = [
  'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOG', 'SPY', 'QQQ',
  'AMD', 'NFLX', 'DIS', 'BA', 'JPM', 'V', 'MA', 'COST', 'WMT', 'HD',
];

interface ScreenerFilter {
  symbols?: string[];
  scanType?: 'covered_call' | 'csp' | 'iron_condor' | 'high_iv' | 'unusual_activity' | 'custom';
  minIV?: number;
  maxIV?: number;
  minDTE?: number;
  maxDTE?: number;
  minDelta?: number;
  maxDelta?: number;
  minVolume?: number;
  minOI?: number;
  minPremiumYield?: number;
}

interface ScreenerResult {
  symbol: string;
  underlying: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  iv: number;
  dte: number;
  volume: number;
  openInterest: number;
  delta: number;
  premiumYield: number;
  stockPrice: number;
}

export async function POST(req: NextRequest) {
  try {
    const filters: ScreenerFilter = await req.json();
    const symbols = filters.symbols || DEFAULT_SCAN_SYMBOLS;

    // Apply preset filters based on scan type
    const appliedFilters = applyPreset(filters);

    const results: ScreenerResult[] = [];

    // Scan each symbol (limit concurrency)
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(sym => scanSymbol(sym, appliedFilters))
      );
      for (const res of batchResults) {
        results.push(...res);
      }
    }

    // Sort by premium yield descending
    results.sort((a, b) => b.premiumYield - a.premiumYield);

    return NextResponse.json({
      results: results.slice(0, 50), // Top 50 results
      count: results.length,
      scanned: symbols.length,
    });
  } catch (err) {
    console.error('Screener error:', err);
    return NextResponse.json({ results: [], error: 'Screener failed' }, { status: 500 });
  }
}

function applyPreset(filters: ScreenerFilter): ScreenerFilter {
  switch (filters.scanType) {
    case 'covered_call':
      return { ...filters, minDelta: 0.2, maxDelta: 0.4, minDTE: 20, maxDTE: 50, minVolume: 10 };
    case 'csp':
      return { ...filters, minDelta: -0.4, maxDelta: -0.2, minDTE: 20, maxDTE: 50, minVolume: 10 };
    case 'iron_condor':
      return { ...filters, minDTE: 25, maxDTE: 50, minVolume: 5 };
    case 'high_iv':
      return { ...filters, minIV: 40, minDTE: 15, maxDTE: 60 };
    case 'unusual_activity':
      return { ...filters, minVolume: 500, minDTE: 5 };
    default:
      return filters;
  }
}

async function scanSymbol(symbol: string, filters: ScreenerFilter): Promise<ScreenerResult[]> {
  try {
    // Get stock quote
    const quoteRes = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
      headers: alpacaHeaders,
    });
    let stockPrice = 0;
    if (quoteRes.ok) {
      const data = await quoteRes.json();
      stockPrice = ((data.quote?.ap || 0) + (data.quote?.bp || 0)) / 2;
    }
    if (stockPrice <= 0) return [];

    // Get option contracts
    const contractsRes = await fetch(
      `${ALPACA_TRADING_URL}/v2/options/contracts?underlying_symbols=${symbol}&status=active&limit=200`,
      { headers: alpacaHeaders }
    );
    if (!contractsRes.ok) return [];

    const contractsData = await contractsRes.json();
    const contracts = contractsData.option_contracts || contractsData.contracts || [];
    if (contracts.length === 0) return [];

    const now = Date.now();
    const results: ScreenerResult[] = [];

    // Get snapshots in batch
    const contractSymbols = contracts.map((c: { symbol: string }) => c.symbol).slice(0, 100);
    const snapshotRes = await fetch(
      `${ALPACA_DATA_URL}/v1beta1/options/snapshots?symbols=${contractSymbols.join(',')}`,
      { headers: alpacaHeaders }
    );

    let snapshots: Record<string, { latestQuote?: { bp: number; ap: number }; latestTrade?: { p: number; s: number }; impliedVolatility?: number; greeks?: { delta: number } }> = {};
    if (snapshotRes.ok) {
      const snapData = await snapshotRes.json();
      snapshots = snapData.snapshots || snapData || {};
    }

    for (const contract of contracts) {
      const dte = Math.ceil((new Date(contract.expiration_date).getTime() - now) / (1000 * 60 * 60 * 24));

      // DTE filter
      if (filters.minDTE && dte < filters.minDTE) continue;
      if (filters.maxDTE && dte > filters.maxDTE) continue;

      const snap = snapshots[contract.symbol];
      if (!snap) continue;

      const bid = snap.latestQuote?.bp || 0;
      const ask = snap.latestQuote?.ap || 0;
      const midPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : snap.latestTrade?.p || 0;
      const iv = (snap.impliedVolatility || 0) * 100;
      const delta = snap.greeks?.delta || 0;
      const volume = snap.latestTrade?.s || 0;

      // IV filter
      if (filters.minIV && iv < filters.minIV) continue;
      if (filters.maxIV && iv > filters.maxIV) continue;

      // Delta filter
      if (filters.minDelta !== undefined && delta < filters.minDelta) continue;
      if (filters.maxDelta !== undefined && delta > filters.maxDelta) continue;

      // Volume filter
      if (filters.minVolume && volume < filters.minVolume) continue;

      // Premium yield: annualized premium / stock price
      const premiumYield = midPrice > 0 && stockPrice > 0
        ? (midPrice / stockPrice) * (365 / Math.max(dte, 1)) * 100
        : 0;

      if (filters.minPremiumYield && premiumYield < filters.minPremiumYield) continue;

      results.push({
        symbol: contract.symbol,
        underlying: symbol,
        strike: contract.strike_price,
        expiration: contract.expiration_date,
        type: contract.type === 'call' ? 'call' : 'put',
        bid,
        ask,
        iv,
        dte,
        volume,
        openInterest: contract.open_interest || 0,
        delta: Math.abs(delta),
        premiumYield: Math.round(premiumYield * 100) / 100,
        stockPrice,
      });
    }

    return results;
  } catch {
    return [];
  }
}
