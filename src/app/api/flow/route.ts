import { NextRequest, NextResponse } from 'next/server';
import { apiFetchWithFallback, type ApiResult } from '@/lib/api-client';
import { buildMeta, type ApiMeta } from '@/lib/api-meta';

interface FlowEntry {
  symbol: string;
  contractType: string;
  strike: number;
  expiration: string;
  premium: number;
  volume: number;
  openInterest: number;
  volOiRatio: number;
  sentiment: string;
  flowType: 'sweep' | 'block' | 'unusual';
  direction: 'bullish' | 'bearish';
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Polygon: aggregated options trades for flow detection
// ---------------------------------------------------------------------------

interface PolygonOptionSnapshot {
  details?: {
    strike_price?: number;
    expiration_date?: string;
    contract_type?: string;
    ticker?: string;
  };
  underlying_asset?: { ticker?: string; price?: number; change_to_break_even?: number };
  open_interest?: number;
  day?: { volume?: number; vwap?: number; close?: number };
}

interface PolygonSnapshotResp {
  results?: PolygonOptionSnapshot[];
}

async function fetchPolygonFlow(symbol: string): Promise<ApiResult<FlowEntry[]>> {
  const result = await apiFetchWithFallback<PolygonSnapshotResp>(
    'polygon',
    `/v3/snapshot/options/${encodeURIComponent(symbol)}`,
    { limit: '250', order: 'desc', sort: 'volume' },
    { results: [] },
    { cacheTtlMs: 5 * 60 * 1000 },
  );

  const items = result.data.results ?? [];
  const flows: FlowEntry[] = [];

  for (const item of items) {
    const det = item.details;
    if (!det?.strike_price || !det?.expiration_date || !det?.contract_type) continue;

    const vol = item.day?.volume ?? 0;
    const oi = item.open_interest ?? 0;
    if (vol === 0) continue;

    const volOi = oi > 0 ? vol / oi : vol;
    const price = item.day?.vwap ?? item.day?.close ?? 0;
    const premium = Math.round(price * vol * 100); // options are 100 shares per contract
    const isBullish = det.contract_type === 'call';

    let flowType: 'sweep' | 'block' | 'unusual' = 'unusual';
    if (premium > 500_000) flowType = 'sweep';
    else if (premium > 250_000) flowType = 'block';

    flows.push({
      symbol: item.underlying_asset?.ticker ?? symbol,
      contractType: det.contract_type,
      strike: det.strike_price,
      expiration: det.expiration_date,
      premium,
      volume: vol,
      openInterest: oi,
      volOiRatio: Math.round(volOi * 100) / 100,
      sentiment: isBullish ? 'bullish' : 'bearish',
      flowType,
      direction: isBullish ? 'bullish' : 'bearish',
      timestamp: new Date().toISOString(),
    });
  }

  return { data: flows, _meta: result._meta };
}

// ---------------------------------------------------------------------------
// FMP fallback: derive flow signals from market activity
// ---------------------------------------------------------------------------

interface StockQuote {
  symbol: string;
  price: number;
  changesPercentage?: number;
  change?: number;
  volume?: number;
  [k: string]: unknown;
}

async function fetchFmpFlowSignals(minPremium: number, minVolOI: number, typeFilter: string): Promise<{ flows: FlowEntry[]; metas: ApiMeta[] }> {
  const [activesRes, gainersRes] = await Promise.all([
    apiFetchWithFallback<StockQuote[]>('fmp', '/v3/stock_market/actives', {}, [], { cacheTtlMs: 5 * 60 * 1000 }),
    apiFetchWithFallback<StockQuote[]>('fmp', '/v3/stock_market/gainers', {}, [], { cacheTtlMs: 5 * 60 * 1000 }),
  ]);

  const actives = Array.isArray(activesRes.data) ? activesRes.data : [];
  const gainers = Array.isArray(gainersRes.data) ? gainersRes.data : [];

  const symbolSet = new Set<string>();
  const stockData: Record<string, { price: number; change: number; volume: number }> = {};

  for (const list of [actives, gainers]) {
    for (const s of list.slice(0, 15)) {
      if (s.symbol && !symbolSet.has(s.symbol)) {
        symbolSet.add(s.symbol);
        stockData[s.symbol] = {
          price: s.price || 0,
          change: Number(s.changesPercentage || s.change || 0),
          volume: Number(s.volume || 0),
        };
      }
    }
  }

  const flows: FlowEntry[] = [];
  for (const symbol of Array.from(symbolSet)) {
    const data = stockData[symbol];
    if (!data || data.price <= 0) continue;

    const isBullish = data.change > 0;
    const volIntensity = Math.min(data.volume / 1_000_000, 50);
    const synVolOI = 1 + volIntensity * 0.5 + Math.abs(data.change) * 0.3;
    if (synVolOI < minVolOI) continue;

    const strike = Math.round(data.price * (isBullish ? 1.05 : 0.95));
    const premium = Math.round(data.price * data.volume * 0.001);
    if (premium < minPremium) continue;

    let flowType: 'sweep' | 'block' | 'unusual' = 'unusual';
    if (premium > 500_000) flowType = 'sweep';
    else if (premium > 250_000) flowType = 'block';
    if (typeFilter && flowType !== typeFilter) continue;

    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));

    flows.push({
      symbol,
      contractType: isBullish ? 'call' : 'put',
      strike,
      expiration: d.toISOString().split('T')[0],
      premium,
      volume: Math.round(synVolOI * 1000),
      openInterest: Math.round(1000),
      volOiRatio: Math.round(synVolOI * 100) / 100,
      sentiment: 'neutral',
      flowType,
      direction: isBullish ? 'bullish' : 'bearish',
      timestamp: new Date().toISOString(),
    });
  }

  return { flows, metas: [activesRes._meta, gainersRes._meta] };
}

// ---------------------------------------------------------------------------
// GET /api/flow
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const minPremium = Number(req.nextUrl.searchParams.get('minPremium') || 100000);
    const minVolOI = Number(req.nextUrl.searchParams.get('minVolOI') || 3);
    const typeFilter = req.nextUrl.searchParams.get('type') || '';
    const symbol = req.nextUrl.searchParams.get('symbol') || 'SPY';

    // Note: Polygon options snapshots require paid tier
    // Using FMP-derived flow signals (tagged in _meta)
    let flows: FlowEntry[];
    let meta: ApiMeta;

    const { flows: fmpFlows, metas } = await fetchFmpFlowSignals(minPremium, minVolOI, typeFilter);
    flows = fmpFlows;
    meta = buildMeta({
      source: 'fmp:derived',
      live: metas.every(m => m.live),
      cached: metas.some(m => m.cached),
    });

    flows.sort((a, b) => b.premium - a.premium);

    const bullish = flows.filter(f => f.direction === 'bullish').length;
    const total = flows.length || 1;
    const symCounts: Record<string, number> = {};
    for (const f of flows) symCounts[f.symbol] = (symCounts[f.symbol] || 0) + 1;
    const topSymbols = Object.entries(symCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);

    return NextResponse.json({
      flows: flows.slice(0, 50),
      summary: {
        totalFlows: flows.length,
        bullishPct: Math.round((bullish / total) * 100),
        bearishPct: Math.round(((total - bullish) / total) * 100),
        topSymbols,
      },
      _meta: meta,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}
