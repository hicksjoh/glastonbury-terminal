// Live quotes for the watchlist.
//
// Why this exists: `watchlist.current_price` was only ever written once, at
// insert time (and the MCP add tool didn't write it at all), so every reader
// — the MCP connector, the Keisha briefing, keisha-context — saw a frozen
// value or null. This module resolves a live price per symbol and is the one
// place readers should go for "what is this ticker worth right now".
//
// Source order:
//   1. Alpaca batch snapshot (IEX feed) — one request for the whole list,
//      works on paper/free keys, independent of the FMP quota.
//   2. FMP /stable/quote per symbol — only for symbols Alpaca didn't price,
//      and skipped entirely while the FMP rate-limit latch is set.
// Anything still unpriced is reported as such; callers must not fabricate.

import { getSnapshots, type AlpacaSnapshot } from '@/lib/alpaca';
import { getQuote, isFmpRateLimited } from '@/lib/fmp-client';
import { log as baseLog } from '@/lib/logger';

const qLog = baseLog.child({ component: 'watchlist-quotes' });

export type QuoteSource = 'alpaca' | 'fmp';

export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
  asOf: string | null;
  source: QuoteSource;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Exported for tests. Converts one Alpaca snapshot into a LiveQuote or null. */
export function quoteFromSnapshot(symbol: string, snap: AlpacaSnapshot | undefined): LiveQuote | null {
  if (!snap) return null;
  const tradePrice = num(snap.latestTrade?.p);
  const barClose = num(snap.dailyBar?.c);
  const price = tradePrice ?? barClose;
  if (price === null) return null;
  const prevClose = num(snap.prevDailyBar?.c);
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  return {
    symbol,
    price,
    prevClose,
    changePct: changePct === null ? null : Math.round(changePct * 100) / 100,
    asOf: (tradePrice !== null ? snap.latestTrade?.t : snap.dailyBar?.t) ?? null,
    source: 'alpaca',
  };
}

export async function getLiveQuotes(symbols: string[]): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const wanted = Array.from(new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (wanted.length === 0) return out;

  try {
    const snaps = await getSnapshots(wanted);
    for (const sym of wanted) {
      const q = quoteFromSnapshot(sym, snaps[sym]);
      if (q) out.set(sym, q);
    }
  } catch (err) {
    qLog.warn({ detail: (err as Error).message?.slice(0, 200) }, 'alpaca snapshots failed — trying FMP');
  }

  const missing = wanted.filter(s => !out.has(s));
  if (missing.length > 0 && !isFmpRateLimited()) {
    const fmp = await Promise.all(missing.map(s => getQuote(s).catch(() => null)));
    fmp.forEach((q, i) => {
      const price = num(q?.price);
      if (!q || price === null) return;
      const sym = missing[i];
      const changePct = typeof q.changePercentage === 'number' ? q.changePercentage : null;
      out.set(sym, {
        symbol: sym,
        price,
        prevClose: null,
        changePct,
        asOf: new Date().toISOString(),
        source: 'fmp',
      });
    });
  }

  return out;
}
