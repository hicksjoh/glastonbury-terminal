import { NextRequest, NextResponse } from 'next/server';
import { calculateGreeks } from '@/lib/options/greeks';
import { buildOCCSymbol } from '@/lib/options/symbols';
import type { OptionChainEntry } from '@/lib/options/types';

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_TRADING_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

// Simple in-memory cache (15 second TTL)
const cache = new Map<string, { data: OptionChainEntry[]; timestamp: number }>();
const CACHE_TTL = 15_000;

interface AlpacaOptionSnapshot {
  symbol: string;
  latestQuote?: {
    ap: number; // ask
    bp: number; // bid
    as: number;
    bs: number;
  };
  latestTrade?: {
    p: number; // price
    s: number; // size
  };
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  impliedVolatility?: number;
  openInterest?: number;
}

interface FMPOptionEntry {
  symbol?: string;
  contractSymbol?: string;
  underlying?: string;
  expiration?: string;
  strike?: number;
  type?: string;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  inTheMoney?: boolean;
}

async function fetchAlpacaChain(symbol: string, expiration?: string): Promise<OptionChainEntry[]> {
  try {
    // First get the stock price for Greeks calculation
    const quoteRes = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
      headers: alpacaHeaders,
    });
    let stockPrice = 0;
    if (quoteRes.ok) {
      const quoteData = await quoteRes.json();
      stockPrice = (quoteData.quote?.ap + quoteData.quote?.bp) / 2 || 0;
    }

    // Fetch option contracts
    const params = new URLSearchParams({
      underlying_symbols: symbol,
      status: 'active',
      limit: '500',
    });
    if (expiration) {
      params.set('expiration_date', expiration);
    }

    const contractsRes = await fetch(
      `${ALPACA_TRADING_URL}/v2/options/contracts?${params}`,
      { headers: alpacaHeaders }
    );

    if (!contractsRes.ok) {
      console.error('Alpaca options contracts error:', contractsRes.status);
      return [];
    }

    const contractsData = await contractsRes.json();
    const contracts = contractsData.option_contracts || contractsData.contracts || [];

    if (contracts.length === 0) return [];

    // Get snapshots for all contracts (in batches)
    const contractSymbols: string[] = contracts.map((c: { symbol: string }) => c.symbol);
    const entries: OptionChainEntry[] = [];

    // Batch snapshot requests (max 100 per request)
    for (let i = 0; i < contractSymbols.length; i += 100) {
      const batch = contractSymbols.slice(i, i + 100);
      const snapshotParams = new URLSearchParams();
      snapshotParams.set('symbols', batch.join(','));

      const snapshotRes = await fetch(
        `${ALPACA_DATA_URL}/v1beta1/options/snapshots?${snapshotParams}`,
        { headers: alpacaHeaders }
      );

      if (snapshotRes.ok) {
        const snapshotData = await snapshotRes.json();
        const snapshots: Record<string, AlpacaOptionSnapshot> = snapshotData.snapshots || snapshotData || {};

        for (const contract of contracts.slice(i, i + 100)) {
          const snap = snapshots[contract.symbol];
          const bid = snap?.latestQuote?.bp ?? 0;
          const ask = snap?.latestQuote?.ap ?? 0;
          const last = snap?.latestTrade?.p ?? 0;
          const midPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;

          // Calculate Greeks if not provided by API
          let greeks = snap?.greeks;
          if (!greeks && stockPrice > 0 && midPrice > 0) {
            const T = Math.max(
              (new Date(contract.expiration_date).getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000),
              0.001
            );
            const type = contract.type === 'call' ? 'call' as const : 'put' as const;
            const calcGreeks = calculateGreeks(stockPrice, contract.strike_price, T, 0.05, snap?.impliedVolatility || 0.3, type);
            greeks = {
              delta: calcGreeks.delta,
              gamma: calcGreeks.gamma,
              theta: calcGreeks.theta,
              vega: calcGreeks.vega,
              rho: calcGreeks.rho,
            };
          }

          entries.push({
            symbol: contract.symbol,
            underlying: symbol,
            expiration: contract.expiration_date,
            strike: contract.strike_price,
            type: contract.type === 'call' ? 'call' : 'put',
            bid,
            ask,
            last,
            volume: snap?.latestTrade?.s ?? 0,
            openInterest: snap?.openInterest ?? contract.open_interest ?? 0,
            impliedVolatility: (snap?.impliedVolatility ?? 0) * 100, // Convert to percentage
            delta: greeks?.delta ?? 0,
            gamma: greeks?.gamma ?? 0,
            theta: greeks?.theta ?? 0,
            vega: greeks?.vega ?? 0,
            rho: greeks?.rho ?? 0,
            inTheMoney: contract.type === 'call'
              ? stockPrice > contract.strike_price
              : stockPrice < contract.strike_price,
          });
        }
      }
    }

    return entries;
  } catch (err) {
    console.error('Alpaca options chain error:', err);
    return [];
  }
}

async function fetchFMPChain(symbol: string, expiration?: string): Promise<OptionChainEntry[]> {
  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return [];

  try {
    let url = `${FMP_BASE_URL}/options-chain?symbol=${symbol}&apikey=${fmpKey}`;
    if (expiration) {
      url += `&date=${expiration}`;
    }

    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    if (text.includes('Legacy') || text.includes('Premium') || text.includes('Restricted')) {
      return [];
    }

    const data: FMPOptionEntry[] = JSON.parse(text);
    if (!Array.isArray(data)) return [];

    return data.map((d) => {
      const type = (d.type || 'call').toLowerCase() as 'call' | 'put';
      const occ = d.contractSymbol || d.symbol || buildOCCSymbol(symbol, d.expiration || '', type, d.strike || 0);

      return {
        symbol: occ,
        underlying: symbol,
        expiration: d.expiration || '',
        strike: d.strike || 0,
        type,
        bid: d.bid || 0,
        ask: d.ask || 0,
        last: d.lastPrice || 0,
        volume: d.volume || 0,
        openInterest: d.openInterest || 0,
        impliedVolatility: (d.impliedVolatility || 0) * 100,
        delta: d.delta || 0,
        gamma: d.gamma || 0,
        theta: d.theta || 0,
        vega: d.vega || 0,
        rho: d.rho || 0,
        inTheMoney: d.inTheMoney || false,
      };
    });
  } catch (err) {
    console.error('FMP options chain error:', err);
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const expiration = req.nextUrl.searchParams.get('expiration') || undefined;

  const cacheKey = `${symbol}:${expiration || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ chain: cached.data, cached: true });
  }

  // Try Alpaca first, fall back to FMP
  let chain = await fetchAlpacaChain(symbol.toUpperCase(), expiration);

  if (chain.length === 0) {
    chain = await fetchFMPChain(symbol.toUpperCase(), expiration);
  }

  // Sort by expiration, then strike
  chain.sort((a, b) => {
    if (a.expiration !== b.expiration) return a.expiration.localeCompare(b.expiration);
    return a.strike - b.strike;
  });

  cache.set(cacheKey, { data: chain, timestamp: Date.now() });

  return NextResponse.json({
    chain,
    symbol: symbol.toUpperCase(),
    count: chain.length,
  });
}
