/**
 * Phase 11 — Prediction Markets (Kalshi + Polymarket).
 *
 * Both have public read endpoints (Kalshi REST, Polymarket Gamma) so the
 * API keys in spec are only needed for placing trades, not for fetching
 * market data. This engine snapshots curated markets every 5 minutes and
 * persists to prediction_market_snapshots.
 */

import { createServiceClient } from '@/lib/supabase';

export type Snapshot = {
  source: 'kalshi' | 'polymarket';
  market_ticker: string;
  market_name: string;
  yes_price: number | null;
  no_price: number | null;
  volume_24h: number | null;
  category: string | null;
};

// ── Kalshi ──────────────────────────────────────────────────────────────────
// Kalshi public REST docs: https://trading-api.readme.io/reference
// `/v3/markets` lists markets; `yes_bid` / `yes_ask` are in cents (0-100).

type KalshiMarket = {
  ticker: string;
  event_ticker?: string;
  series_ticker?: string;
  title: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  volume_24h?: number;
  category?: string;
  status?: string;
};

async function fetchKalshiMarkets(tickers: string[]): Promise<KalshiMarket[]> {
  if (tickers.length === 0) return [];
  const results: KalshiMarket[] = [];
  // Kalshi supports a `tickers` filter; request them all in one call.
  try {
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets?tickers=${encodeURIComponent(tickers.join(','))}&limit=50`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GlastonburyTerminal/1.0 hicksjoh@gmail.com',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body?.markets)) results.push(...(body.markets as KalshiMarket[]));
    }
  } catch { /* noop */ }
  return results;
}

// ── Polymarket ──────────────────────────────────────────────────────────────
// Polymarket Gamma API: https://docs.polymarket.com/#gamma-markets-api
// Public: `/events/{slug}` or `/markets?active=true&closed=false&limit=N`.
// Price returned as decimal 0-1 ("outcomePrices" stringified array).

type PolymarketMarket = {
  id: string;
  slug: string;
  question: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume24hr?: string | number;
  volumeNum?: number;
  category?: string;
  active?: boolean;
  closed?: boolean;
};

async function fetchPolymarketByIds(ids: string[]): Promise<PolymarketMarket[]> {
  if (ids.length === 0) return [];
  try {
    const params = new URLSearchParams();
    ids.forEach(id => params.append('id', id));
    params.set('limit', '50');
    const res = await fetch(`https://gamma-api.polymarket.com/markets?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body as PolymarketMarket[] : [];
  } catch {
    return [];
  }
}

async function fetchPolymarketTopActive(limit = 8): Promise<PolymarketMarket[]> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body as PolymarketMarket[] : [];
  } catch {
    return [];
  }
}

// ── Curated market list ─────────────────────────────────────────────────────
// 8 markets matching the Phase 11 spec: Fed cut prob, CPI surprise, recession
// 12mo, next jobs print, GDP direction, 2026 election macros.
// Kalshi ticker formats and Polymarket ids change; keep these env-overridable.

const KALSHI_TICKERS = (process.env.KALSHI_WATCH_TICKERS || [
  'FED.25.DEC', // Fed decision Dec 2025 (placeholder; Wes may want to customize)
  'CPI.25.DEC',
  'RECESSION.26',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

const POLYMARKET_IDS = (process.env.POLYMARKET_WATCH_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

function mapKalshi(m: KalshiMarket): Snapshot | null {
  if (!m.ticker || !m.title) return null;
  // Kalshi yes prices are 0-100 cents
  const yes = typeof m.yes_bid === 'number' && typeof m.yes_ask === 'number'
    ? ((m.yes_bid + m.yes_ask) / 2) / 100
    : typeof m.last_price === 'number' ? m.last_price / 100 : null;
  return {
    source: 'kalshi',
    market_ticker: m.ticker,
    market_name: m.title,
    yes_price: yes,
    no_price: yes != null ? 1 - yes : null,
    volume_24h: typeof m.volume_24h === 'number' ? m.volume_24h : null,
    category: m.category ?? null,
  };
}

function mapPolymarket(m: PolymarketMarket): Snapshot | null {
  if (!m.id || !m.question) return null;
  let outcomes: string[] = [];
  let prices: number[] = [];
  try {
    outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : (m.outcomes ?? []);
    const rawPrices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices ?? []);
    prices = (rawPrices as string[]).map(p => Number(p)).filter(n => isFinite(n));
  } catch { /* noop */ }
  // Find "Yes" outcome if present
  const yesIdx = outcomes.findIndex(o => o?.toLowerCase() === 'yes');
  const yes = yesIdx >= 0 && prices[yesIdx] != null ? prices[yesIdx] : (prices[0] ?? null);
  return {
    source: 'polymarket',
    market_ticker: m.id,
    market_name: m.question,
    yes_price: yes,
    no_price: yes != null ? 1 - yes : null,
    volume_24h: typeof m.volumeNum === 'number' ? m.volumeNum : typeof m.volume24hr === 'string' ? Number(m.volume24hr) : null,
    category: m.category ?? null,
  };
}

// ── Main snapshotter ────────────────────────────────────────────────────────
export async function takePredictionSnapshot(): Promise<{ inserted: number; deltas: Array<Snapshot & { delta_24h: number | null }> }> {
  const [kalshi, polymarket] = await Promise.all([
    fetchKalshiMarkets(KALSHI_TICKERS),
    POLYMARKET_IDS.length ? fetchPolymarketByIds(POLYMARKET_IDS) : fetchPolymarketTopActive(8),
  ]);

  const snapshots: Snapshot[] = [
    ...kalshi.map(mapKalshi).filter((s): s is Snapshot => !!s),
    ...polymarket.map(mapPolymarket).filter((s): s is Snapshot => !!s),
  ];

  if (snapshots.length === 0) return { inserted: 0, deltas: [] };

  const sb = createServiceClient();

  // Compute 24h delta: look up yes_price from 24h ago for each ticker.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: priorRows } = await sb
    .from('prediction_market_snapshots')
    .select('market_ticker, yes_price, snapshot_at')
    .in('market_ticker', snapshots.map(s => s.market_ticker))
    .lt('snapshot_at', oneDayAgo)
    .order('snapshot_at', { ascending: false })
    .limit(500);
  const priorByTicker: Record<string, number> = {};
  for (const r of (priorRows as unknown as { market_ticker: string; yes_price: number | null }[]) ?? []) {
    if (r.yes_price != null && priorByTicker[r.market_ticker] == null) {
      priorByTicker[r.market_ticker] = r.yes_price;
    }
  }

  const now = new Date().toISOString();
  const rows = snapshots.map(s => {
    const prior = priorByTicker[s.market_ticker];
    const delta = (s.yes_price != null && prior != null) ? s.yes_price - prior : null;
    return {
      source: s.source,
      market_ticker: s.market_ticker,
      market_name: s.market_name,
      yes_price: s.yes_price,
      no_price: s.no_price,
      volume_24h: s.volume_24h,
      delta_24h: delta,
      category: s.category,
      snapshot_at: now,
    };
  });

  const { error } = await sb.from('prediction_market_snapshots').insert(rows);
  if (error) throw new Error(`prediction_market_snapshots insert: ${error.message}`);

  return {
    inserted: rows.length,
    deltas: rows.map(r => ({ ...(r as unknown as Snapshot), delta_24h: r.delta_24h })),
  };
}

// ── Latest snapshot reader (for UI + briefing context) ──────────────────────
export async function fetchLatestSnapshots(): Promise<Array<Snapshot & { delta_24h: number | null; snapshot_at: string }>> {
  const sb = createServiceClient();
  // Pull the most recent row per market_ticker via a distinct-on approximation:
  // fetch last 100 rows, dedupe in memory, keep first-seen (which is newest).
  const { data } = await sb.from('prediction_market_snapshots')
    .select('source, market_ticker, market_name, yes_price, no_price, volume_24h, delta_24h, category, snapshot_at')
    .order('snapshot_at', { ascending: false })
    .limit(120);
  const seen = new Set<string>();
  const out: Array<Snapshot & { delta_24h: number | null; snapshot_at: string }> = [];
  for (const row of (data as unknown as Array<Snapshot & { delta_24h: number | null; snapshot_at: string }>) ?? []) {
    if (seen.has(row.market_ticker)) continue;
    seen.add(row.market_ticker);
    out.push(row);
  }
  return out.slice(0, 12);
}
