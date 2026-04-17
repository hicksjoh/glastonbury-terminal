/**
 * Phase 8 — Weekly Tax-Loss Harvester.
 *
 * Scans Alpaca positions for unrealized losses > threshold, finds wash-sale-
 * safe correlated swap candidates, and writes suggestions into
 * tax_harvest_suggestions. Cron-driven (Sunday 5pm PT via Vercel) but also
 * invocable on-demand from /tax/harvest/weekly.
 */

import { createServiceClient } from '@/lib/supabase';
import { fetchBars, type Bar } from '@/lib/crew-data';

export const MIN_LOSS_USD = Number(process.env.TAX_HARVEST_MIN_LOSS_USD ?? '500');
export const FEDERAL_TAX_RATE = Number(process.env.TAX_HARVEST_FEDERAL_RATE ?? '0.37');

const ETF_POOL: { sector: string; ticker: string }[] = [
  { sector: 'broad_us', ticker: 'VTI' },
  { sector: 'broad_us', ticker: 'ITOT' },
  { sector: 'broad_us', ticker: 'SCHB' },
  { sector: 'sp500', ticker: 'SPY' },
  { sector: 'sp500', ticker: 'IVV' },
  { sector: 'sp500', ticker: 'VOO' },
  { sector: 'nasdaq', ticker: 'QQQ' },
  { sector: 'nasdaq', ticker: 'QQQM' },
  { sector: 'smallcap', ticker: 'IWM' },
  { sector: 'smallcap', ticker: 'VB' },
  { sector: 'tech', ticker: 'XLK' },
  { sector: 'tech', ticker: 'VGT' },
  { sector: 'tech', ticker: 'IYW' },
  { sector: 'semis', ticker: 'SMH' },
  { sector: 'semis', ticker: 'SOXX' },
  { sector: 'energy', ticker: 'XLE' },
  { sector: 'energy', ticker: 'VDE' },
  { sector: 'financials', ticker: 'XLF' },
  { sector: 'financials', ticker: 'VFH' },
  { sector: 'healthcare', ticker: 'XLV' },
  { sector: 'healthcare', ticker: 'VHT' },
  { sector: 'consumer_disc', ticker: 'XLY' },
  { sector: 'consumer_disc', ticker: 'VCR' },
  { sector: 'consumer_staples', ticker: 'XLP' },
  { sector: 'consumer_staples', ticker: 'VDC' },
  { sector: 'industrials', ticker: 'XLI' },
  { sector: 'industrials', ticker: 'VIS' },
  { sector: 'utilities', ticker: 'XLU' },
  { sector: 'utilities', ticker: 'VPU' },
  { sector: 'reits', ticker: 'VNQ' },
  { sector: 'reits', ticker: 'SCHH' },
  { sector: 'communications', ticker: 'XLC' },
  { sector: 'communications', ticker: 'VOX' },
  { sector: 'materials', ticker: 'XLB' },
];

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  avg_entry_price: string;
};

// ── Correlation ─────────────────────────────────────────────────────────────
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const aa = a.slice(-n);
  const bb = b.slice(-n);
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += aa[i]; sumB += bb[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aa[i] - meanA, db = bb[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

function barsToDailyReturns(bars: Bar[]): number[] {
  if (bars.length < 2) return [];
  const closes = bars.map(b => b.c);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  return rets;
}

export type SwapCandidate = {
  ticker: string;
  correlation: number;
};

export async function findSwapCandidate(
  loserBars: Bar[],
  excludeTickers: Set<string>,
): Promise<SwapCandidate | null> {
  const loserRets = barsToDailyReturns(loserBars);
  if (loserRets.length < 30) return null;

  // Evaluate ETFs in parallel (batched to keep request count sane)
  const candidates = ETF_POOL.filter(e => !excludeTickers.has(e.ticker));
  let best: SwapCandidate | null = null;

  // Process in small batches to avoid overwhelming Alpaca
  const BATCH = 6;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async c => {
        const bars = await fetchBars(c.ticker, '1Day', 120);
        const rets = barsToDailyReturns(bars);
        const corr = pearson(loserRets, rets);
        return { ticker: c.ticker, corr };
      }),
    );
    for (const r of results) {
      if (!best || r.corr > best.correlation) best = { ticker: r.ticker, correlation: r.corr };
      if (best && best.correlation > 0.96) return best; // early exit on very strong match
    }
  }
  // Only return if above threshold.
  if (best && best.correlation >= 0.90) return best;
  return null;
}

// ── Wash-sale check ─────────────────────────────────────────────────────────
// Simple: look at Alpaca activities (buys/sells) for the last 30 days. If
// we've bought the same ticker (or swap candidate) within 30 days, flag wash
// sale. Alpaca's /v2/account/activities endpoint is the source of truth.
export type Activity = { activity_type: string; symbol?: string; transaction_time?: string; side?: string };

async function fetchRecentActivities(): Promise<Activity[]> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY;
  const base = process.env.ALPACA_TRADING_URL || process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  if (!key || !secret) return [];
  const after = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${base}/v2/account/activities?direction=desc&activity_types=FILL&after=${encodeURIComponent(after)}&page_size=100`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  } catch { return []; }
}

export function wouldBeWashSale(
  loserTicker: string,
  swapTicker: string,
  activities: Activity[],
): boolean {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const a of activities) {
    if (!a.symbol || !a.transaction_time) continue;
    if (a.side !== 'buy') continue;
    const t = new Date(a.transaction_time).getTime();
    if (t < thirtyDaysAgo) continue;
    if (a.symbol === loserTicker || a.symbol === swapTicker) return true;
  }
  return false;
}

// ── Harvest sizing ──────────────────────────────────────────────────────────
function suggestHarvestQty(position: AlpacaPosition): number {
  // Default: sell the entire lot. In future we'll refine with tax-lot granularity.
  return Math.abs(Number(position.qty) || 0);
}

// ── Main entry: generate suggestions ────────────────────────────────────────
export type HarvestSuggestion = {
  position_ticker: string;
  position_cost_basis: number;
  position_market_value: number;
  unrealized_loss: number;
  suggested_harvest_qty: number;
  swap_candidate_ticker: string | null;
  swap_correlation: number | null;
  wash_sale_safe: boolean;
  estimated_tax_savings_usd: number;
  notes: string;
};

export async function runTaxHarvestScan(args?: { userId?: string }): Promise<HarvestSuggestion[]> {
  const userId = args?.userId ?? 'wes';

  // Pull positions
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET_KEY;
  const base = process.env.ALPACA_TRADING_URL || process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  if (!key || !secret) return [];

  let positions: AlpacaPosition[] = [];
  try {
    const res = await fetch(`${base}/v2/positions`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) positions = await res.json();
  } catch { /* fall through */ }

  const losers = positions.filter(p => Number(p.unrealized_pl) <= -MIN_LOSS_USD);
  if (losers.length === 0) return [];

  const activities = await fetchRecentActivities();

  const suggestions: HarvestSuggestion[] = [];
  for (const p of losers) {
    const bars = await fetchBars(p.symbol, '1Day', 120);
    const excl = new Set<string>([p.symbol]);
    const swap = await findSwapCandidate(bars, excl);

    const loss = Math.abs(Number(p.unrealized_pl));
    const taxSavings = Math.round(loss * FEDERAL_TAX_RATE);

    let washSafe = true;
    if (swap) washSafe = !wouldBeWashSale(p.symbol, swap.ticker, activities);

    suggestions.push({
      position_ticker: p.symbol,
      position_cost_basis: Number(p.cost_basis),
      position_market_value: Number(p.market_value),
      unrealized_loss: -loss,
      suggested_harvest_qty: suggestHarvestQty(p),
      swap_candidate_ticker: swap?.ticker ?? null,
      swap_correlation: swap?.correlation ?? null,
      wash_sale_safe: washSafe,
      estimated_tax_savings_usd: taxSavings,
      notes: swap
        ? `Harvest ${p.symbol} ${loss >= 1000 ? '($1K+ loss)' : ''} → swap into ${swap.ticker} (corr ${swap.correlation.toFixed(3)}). Est fed tax savings ~$${taxSavings} at ${(FEDERAL_TAX_RATE * 100).toFixed(0)}% rate. ${washSafe ? 'Wash-sale safe.' : 'WASH-SALE RISK — review Alpaca activity.'}`
        : `Harvest ${p.symbol} — no high-correlation (>0.90) ETF swap found. Est fed tax savings ~$${taxSavings}. Consider unique hedge.`,
    });
  }
  void userId; // reserved for future multi-user support
  return suggestions;
}

// ── Persist ─────────────────────────────────────────────────────────────────
function weekOfISO(): string {
  // Return the Monday of the current week in ISO date.
  const d = new Date();
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function persistSuggestions(userId: string, suggestions: HarvestSuggestion[]): Promise<{ inserted: number; week_of: string }> {
  const sb = createServiceClient();
  const week = weekOfISO();

  // Delete prior suggestions for this user + week (idempotent re-runs).
  await sb.from('tax_harvest_suggestions')
    .delete()
    .eq('user_id', userId)
    .eq('week_of', week)
    .eq('status', 'suggested'); // don't clobber queued/executed

  if (suggestions.length === 0) return { inserted: 0, week_of: week };

  const rows = suggestions.map(s => ({
    user_id: userId,
    week_of: week,
    position_ticker: s.position_ticker,
    position_cost_basis: s.position_cost_basis,
    position_market_value: s.position_market_value,
    unrealized_loss: s.unrealized_loss,
    suggested_harvest_qty: s.suggested_harvest_qty,
    swap_candidate_ticker: s.swap_candidate_ticker,
    swap_correlation: s.swap_correlation,
    wash_sale_safe: s.wash_sale_safe,
    estimated_tax_savings_usd: s.estimated_tax_savings_usd,
    status: 'suggested',
    notes: s.notes,
  }));
  const { error } = await sb.from('tax_harvest_suggestions').insert(rows);
  if (error) throw new Error(`tax_harvest_suggestions insert: ${error.message}`);
  return { inserted: rows.length, week_of: week };
}
