import { NextRequest, NextResponse } from 'next/server';
import {
  calculateGEX, gexImpact, OptionsChainItem,
  calculateVannaExposure, calculateCharmExposure, calculateGammaFlipLevel,
} from '@/lib/gex-engine';
import { apiFetchWithFallback, type ApiResult } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Polygon.io options snapshot → OptionsChainItem[]
// ---------------------------------------------------------------------------

interface PolygonOptionResult {
  details?: {
    strike_price?: number;
    expiration_date?: string;
    contract_type?: string;
  };
  greeks?: { gamma?: number };
  open_interest?: number;
  day?: { volume?: number };
}

interface PolygonSnapshotResponse {
  results?: PolygonOptionResult[];
  status?: string;
}

async function fetchPolygonChain(symbol: string): Promise<ApiResult<OptionsChainItem[] | null>> {
  const result = await apiFetchWithFallback<PolygonSnapshotResponse>(
    'polygon',
    `/v3/snapshot/options/${encodeURIComponent(symbol)}`,
    { limit: '250' },
    { results: [] },
    { cacheTtlMs: 5 * 60 * 1000 }, // 5min cache — Polygon is tight at 5/min
  );

  const items = result.data.results;
  if (!items || items.length === 0) {
    return { data: null, _meta: result._meta };
  }

  // Group by strike+expiration
  const grouped = new Map<string, OptionsChainItem>();

  for (const item of items) {
    const det = item.details;
    if (!det?.strike_price || !det?.expiration_date || !det?.contract_type) continue;

    const key = `${det.strike_price}-${det.expiration_date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        strike: det.strike_price,
        expiration: det.expiration_date,
        callOI: 0, putOI: 0,
        callGamma: 0, putGamma: 0,
        callVolume: 0, putVolume: 0,
      });
    }

    const entry = grouped.get(key)!;
    const gamma = item.greeks?.gamma ?? 0;
    const oi = item.open_interest ?? 0;
    const vol = item.day?.volume ?? 0;

    if (det.contract_type === 'call') {
      entry.callOI += oi;
      entry.callGamma = gamma;
      entry.callVolume += vol;
    } else {
      entry.putOI += oi;
      entry.putGamma = gamma;
      entry.putVolume += vol;
    }
  }

  const chain = Array.from(grouped.values());
  return { data: chain.length > 0 ? chain : null, _meta: result._meta };
}

// ---------------------------------------------------------------------------
// Alpaca options snapshot (existing fallback)
// ---------------------------------------------------------------------------

async function fetchAlpacaChain(symbol: string): Promise<ApiResult<OptionsChainItem[] | null>> {
  const keyId = process.env.ALPACA_API_KEY ?? '';
  const secret = process.env.ALPACA_SECRET_KEY ?? '';
  if (!keyId || !secret) return { data: null, _meta: buildMeta({ source: 'alpaca', live: false, error: 'no key' }) };

  try {
    const url = `https://data.alpaca.markets/v1beta1/options/snapshots/${encodeURIComponent(symbol)}?feed=indicative`;
    const res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret },
    });
    if (!res.ok) return { data: null, _meta: buildMeta({ source: 'alpaca', live: false, error: `HTTP ${res.status}` }) };

    const data = await res.json();
    if (!data.snapshots || typeof data.snapshots !== 'object') {
      return { data: null, _meta: buildMeta({ source: 'alpaca', live: false, error: 'no snapshots' }) };
    }

    const grouped = new Map<string, OptionsChainItem>();
    for (const [contractSymbol, snap] of Object.entries(data.snapshots) as [string, any][]) {
      const match = contractSymbol.match(/([A-Z]+)\s*(\d{6})([CP])(\d{8})/);
      if (!match) continue;

      const expiration = `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`;
      const optionType = match[3];
      const strike = parseInt(match[4], 10) / 1000;
      const key = `${strike}-${expiration}`;

      if (!grouped.has(key)) {
        grouped.set(key, { strike, expiration, callOI: 0, putOI: 0, callGamma: 0, putGamma: 0, callVolume: 0, putVolume: 0 });
      }
      const entry = grouped.get(key)!;
      const gamma = snap?.greeks?.gamma ?? 0;
      const oi = snap?.openInterest ?? 0;
      const volume = snap?.latestTrade?.s ?? 0;

      if (optionType === 'C') {
        entry.callOI += oi;
        entry.callGamma = gamma;
        entry.callVolume += volume;
      } else {
        entry.putOI += oi;
        entry.putGamma = gamma;
        entry.putVolume += volume;
      }
    }

    const chain = Array.from(grouped.values());
    return {
      data: chain.length > 0 ? chain : null,
      _meta: buildMeta({ source: 'alpaca', live: true }),
    };
  } catch (err) {
    return { data: null, _meta: buildMeta({ source: 'alpaca', live: false, error: String(err) }) };
  }
}

// ---------------------------------------------------------------------------
// Synthetic chain (last resort fallback — always tagged as not live)
// ---------------------------------------------------------------------------

function syntheticGamma(spot: number, strike: number, dte: number): number {
  const t = Math.max(dte / 365, 0.001);
  const sigma = 0.2;
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  return Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (spot * sigma * Math.sqrt(t));
}

function generateSyntheticChain(spot: number, symbol: string): OptionsChainItem[] {
  const chain: OptionsChainItem[] = [];
  const today = new Date();
  const expirations: string[] = [];

  const fri1 = new Date(today);
  fri1.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
  expirations.push(fri1.toISOString().split('T')[0]);
  const fri2 = new Date(fri1);
  fri2.setDate(fri1.getDate() + 7);
  expirations.push(fri2.toISOString().split('T')[0]);
  const monthly = new Date(today);
  monthly.setDate(today.getDate() + 30);
  expirations.push(monthly.toISOString().split('T')[0]);

  const spacing = spot > 400 ? 5 : spot > 100 ? 2 : spot > 50 ? 1 : 0.5;
  const range = spot * 0.1;
  const low = Math.floor((spot - range) / spacing) * spacing;
  const high = Math.ceil((spot + range) / spacing) * spacing;

  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i) * (i + 1);
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed & 0x7fffffff) / 0x7fffffff; };

  for (const exp of expirations) {
    const dte = Math.max(1, Math.round((new Date(exp).getTime() - today.getTime()) / 86400000));
    for (let strike = low; strike <= high; strike += spacing) {
      const gamma = syntheticGamma(spot, strike, dte);
      const moneyness = Math.abs(spot - strike) / spot;
      const atm = Math.exp(-moneyness * moneyness * 200);
      const bonus = strike % (spacing * 10) === 0 ? 1.8 : 1;
      const baseOI = 2000 + rng() * 8000;
      chain.push({
        strike: roundTo(strike, 2), expiration: exp,
        callOI: Math.round(baseOI * atm * bonus * (1 + rng() * 0.5)),
        putOI: Math.round(baseOI * atm * bonus * (1 + rng() * 0.5)),
        callGamma: roundTo(gamma * (1 + (rng() - 0.5) * 0.1), 8),
        putGamma: roundTo(gamma * (1 + (rng() - 0.5) * 0.1), 8),
        callVolume: Math.round(baseOI * atm * (0.05 + rng() * 0.15)),
        putVolume: Math.round(baseOI * atm * (0.05 + rng() * 0.15)),
      });
    }
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Spot price fetcher
// ---------------------------------------------------------------------------

async function fetchSpotPrice(symbol: string): Promise<ApiResult<number>> {
  const defaults: Record<string, number> = {
    SPY: 570, QQQ: 480, IWM: 210, AAPL: 230, TSLA: 270,
    NVDA: 120, AMZN: 200, MSFT: 420, META: 590, GOOGL: 165,
  };
  const result = await apiFetchWithFallback<{ price: number }[]>(
    'fmp', `/v3/quote/${encodeURIComponent(symbol)}`, {}, [],
    { cacheTtlMs: 60 * 1000 },
  );
  const price = Array.isArray(result.data) && result.data[0]?.price
    ? result.data[0].price
    : defaults[symbol] ?? 100;
  return { data: price, _meta: result._meta };
}

// ---------------------------------------------------------------------------
// GET /api/gex
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const symbol = (request.nextUrl.searchParams.get('symbol') ?? 'SPY').toUpperCase();
    const hasPolygon = !!process.env.POLYGON_API_KEY;

    const spotResult = await fetchSpotPrice(symbol);
    const spotPrice = spotResult.data;

    // Priority: Polygon → Alpaca → Synthetic
    let chain: OptionsChainItem[] | null = null;
    let dataSource = 'synthetic';
    let chainMeta: ApiMeta;

    if (hasPolygon) {
      const polyResult = await fetchPolygonChain(symbol);
      if (polyResult.data) {
        chain = polyResult.data;
        dataSource = 'polygon';
        chainMeta = polyResult._meta;
      }
    }

    if (!chain) {
      const alpacaResult = await fetchAlpacaChain(symbol);
      if (alpacaResult.data) {
        chain = alpacaResult.data;
        dataSource = 'alpaca';
        chainMeta = alpacaResult._meta;
      }
    }

    if (!chain) {
      chain = generateSyntheticChain(spotPrice, symbol);
      dataSource = 'synthetic';
      chainMeta = buildMeta({ source: 'synthetic', live: false, error: 'No live options data — using synthetic chain' });
    } else {
      chainMeta ??= buildMeta({ source: dataSource, live: true });
    }

    // Calculate GEX
    const result = calculateGEX(chain, spotPrice);
    const impact = gexImpact(result.levels.netGEX, spotPrice);
    const vannaExposure = roundTo(calculateVannaExposure(chain, spotPrice), 2);
    const charmExposure = roundTo(calculateCharmExposure(chain, spotPrice), 2);
    const gexArray = Array.from(result.byStrike.entries()).map(([strike, gex]) => ({ strike, gex }));
    const preciseFlip = calculateGammaFlipLevel(gexArray);

    const byStrike = Array.from(result.byStrike.entries())
      .map(([strike, gex]) => ({ strike, gex: roundTo(gex, 2) }))
      .sort((a, b) => a.strike - b.strike);

    const expMap = new Map<string, number>();
    for (const item of chain) {
      const callGEX = item.callOI * 100 * item.callGamma * spotPrice * spotPrice * 0.01;
      const putGEX = item.putOI * 100 * item.putGamma * spotPrice * spotPrice * 0.01;
      expMap.set(item.expiration, (expMap.get(item.expiration) ?? 0) + (callGEX - putGEX));
    }
    const expirationBreakdown = Array.from(expMap.entries())
      .map(([exp, gex]) => ({ expiration: exp, gex: roundTo(gex, 2) }))
      .sort((a, b) => a.expiration.localeCompare(b.expiration));

    return NextResponse.json({
      symbol, spotPrice,
      netGEX: roundTo(result.levels.netGEX, 2),
      regime: result.levels.regime,
      levels: {
        putWall: result.levels.putWall,
        callWall: result.levels.callWall,
        hvl: result.levels.hvl,
        gammaFlip: result.levels.gammaFlip,
        gammaFlipPrecise: preciseFlip ? roundTo(preciseFlip, 2) : null,
        pinStrikes: result.levels.pinStrikes,
      },
      vannaExposure, charmExposure,
      impact, byStrike, expirationBreakdown,
      dataSource,
      lastUpdated: new Date().toISOString(),
      _meta: buildMeta({
        source: dataSource,
        live: chainMeta!.live,
        cached: chainMeta!.cached,
        stale: chainMeta!.stale,
        error: chainMeta!.error,
      }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[/api/gex] Error:', message);
    return NextResponse.json({
      error: message,
      _meta: buildMeta({ source: 'error', live: false, error: message }),
    }, { status: 500 });
  }
}
