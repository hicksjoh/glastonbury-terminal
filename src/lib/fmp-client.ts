// FMP client — talks to `/stable` endpoints only. The user is on FMP's
// post-August-2025 tier, which returns 403 "Legacy Endpoint" for all
// `/api/v3/*` paths. Any new FMP call should go through this module.
//
// See memory/builders/D1.md for the full endpoint matrix.

const FMP_STABLE = 'https://financialmodelingprep.com/stable';
const FMP_TIMEOUT_MS = 5_000;
const SECTOR_CACHE_TTL_MS = 5 * 60 * 1_000;

function key(): string | null {
  const k = process.env.FMP_API_KEY;
  return k && k.length > 0 ? k : null;
}

async function fmpFetch(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FMP_TIMEOUT_MS) });
}

export interface FmpQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercentage: number;
  dayLow: number;
  dayHigh: number;
  yearLow: number;
  yearHigh: number;
  marketCap: number;
  volume: number;
}

export async function getQuote(symbol: string): Promise<FmpQuote | null> {
  const k = key();
  if (!k) return null;
  const url = `${FMP_STABLE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as FmpQuote;
  } catch {
    return null;
  }
}

export async function getQuotes(symbols: string[]): Promise<FmpQuote[]> {
  if (symbols.length === 0) return [];
  const k = key();
  if (!k) return [];
  // /stable/quote accepts comma-separated symbols
  const url = `${FMP_STABLE}/quote?symbol=${symbols.map(encodeURIComponent).join(',')}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as FmpQuote[]) : [];
  } catch {
    return [];
  }
}

// ─── Sector performance ──────────────────────────────────────────────
// `/stable/sector-performance-snapshot` requires a `date` param (YYYY-MM-DD)
// and returns one row per sector × exchange. We aggregate across exchanges
// and keep the legacy `{ sector, changesPercentage }` shape so call sites
// don't need to know the format changed.

interface SectorSnapshotRow {
  date: string;
  sector: string;
  exchange: string;
  averageChange: number;
}

export interface SectorPerformance {
  sector: string;
  /** Average percent change across exchanges, as a number (e.g. 1.24 for +1.24%). */
  changesPercentage: number;
}

let sectorCache: { at: number; value: SectorPerformance[] } | null = null;

/**
 * Returns "YYYY-MM-DD" for the most recent weekday ≤ today.
 * Equities don't trade Sat/Sun; this doesn't handle market holidays, so the
 * caller should fall back to earlier dates if the response is empty.
 */
function mostRecentTradingDay(from = new Date()): string {
  const d = new Date(from);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

function offsetDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchSectorSnapshot(date: string): Promise<SectorSnapshotRow[]> {
  const k = key();
  if (!k) return [];
  const url = `${FMP_STABLE}/sector-performance-snapshot?date=${date}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as SectorSnapshotRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Fetches sector performance for the most recent trading day, aggregated
 * across exchanges. Cached in-memory for 5 min. Returns `[]` on failure
 * (callers should degrade gracefully).
 */
export async function getSectorPerformance(): Promise<SectorPerformance[]> {
  const now = Date.now();
  if (sectorCache && now - sectorCache.at < SECTOR_CACHE_TTL_MS) {
    return sectorCache.value;
  }

  // Try today → -1 → -2 → ... up to 5 calendar days back to cover holiday weekends.
  let rows: SectorSnapshotRow[] = [];
  let tryDate = mostRecentTradingDay();
  for (let i = 0; i < 5 && rows.length === 0; i++) {
    rows = await fetchSectorSnapshot(tryDate);
    if (rows.length === 0) tryDate = mostRecentTradingDay(new Date(offsetDate(tryDate, -1) + 'T00:00:00Z'));
  }

  if (rows.length === 0) {
    // Don't cache empty — we want to retry next call.
    return [];
  }

  // Aggregate: one row per sector = mean(averageChange) across exchanges.
  const bySector: Record<string, number[]> = {};
  for (const row of rows) {
    if (!row.sector) continue;
    if (!bySector[row.sector]) bySector[row.sector] = [];
    bySector[row.sector].push(row.averageChange);
  }

  const result: SectorPerformance[] = Object.keys(bySector).map(sector => {
    const values = bySector[sector];
    const mean = values.reduce((s: number, v: number) => s + v, 0) / values.length;
    return { sector, changesPercentage: Number(mean.toFixed(4)) };
  });

  // Sort by absolute magnitude descending (biggest movers first).
  result.sort((a, b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage));

  sectorCache = { at: now, value: result };
  return result;
}

/**
 * Invalidates the in-memory sector cache. Useful for tests.
 */
export function clearSectorCache(): void {
  sectorCache = null;
}
