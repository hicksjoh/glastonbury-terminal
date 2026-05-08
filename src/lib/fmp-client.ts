// FMP client — talks to `/stable` endpoints only. The user is on FMP's
// post-August-2025 tier, which returns 403 "Legacy Endpoint" for all
// `/api/v3/*` and `/api/v4/*` paths. Any new FMP call MUST go through this
// module. The api-client wrapper throws when a v3/v4 path is requested
// (P0-1, hardening/p0-codex-fixes).
//
// See memory/builders/D1.md for the full endpoint matrix.
//
// p6-14 (Codex #9): every failure mode now emits a structured log line so
// the operator can tell "FMP timed out" vs "FMP returned 402 paid-tier" vs
// "the symbol genuinely has no data." Pre-p6-14 every failure returned
// `null` silently — UI couldn't distinguish, ops couldn't alert.
// Return contract is preserved (null on failure) so existing callers
// don't change.

import { log as baseLog } from './logger';

export const FMP_STABLE = 'https://financialmodelingprep.com/stable';
const FMP_TIMEOUT_MS = 5_000;
const SECTOR_CACHE_TTL_MS = 5 * 60 * 1_000;

const fmpLog = baseLog.child({ component: 'fmp-client' });

/** Categorize a fetch failure for log filtering / aggregation. */
function classifyFmpError(err: unknown): { mode: string; detail: string } {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { mode: 'timeout', detail: `${FMP_TIMEOUT_MS}ms exceeded` };
    }
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      return { mode: 'network', detail: err.message.slice(0, 200) };
    }
    return { mode: 'other', detail: err.message.slice(0, 200) };
  }
  return { mode: 'unknown', detail: String(err).slice(0, 200) };
}

/**
 * Endpoints that return a 402 (paid tier) on the current plan are surfaced as
 * `{ unavailable: true, reason: 'plan_limit' }` so the UI can render a real
 * "not on this plan" state instead of an empty array that looks like 0 results.
 */
export type FmpUnavailable = { unavailable: true; reason: 'plan_limit' | 'no_key' | 'unknown_path' };
export function isFmpUnavailable<T>(v: T | FmpUnavailable): v is FmpUnavailable {
  return !!v && typeof v === 'object' && (v as FmpUnavailable).unavailable === true;
}

function key(): string | null {
  const k = process.env.FMP_API_KEY;
  return k && k.length > 0 ? k : null;
}

async function fmpFetch(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FMP_TIMEOUT_MS) });
}

/**
 * Build a /stable URL with the API key tacked on as `apikey`. Caller passes the
 * leading-slash path (e.g. `/biggest-gainers`) and any query params.
 *
 * Centralized so tests can stub one helper and every wrapper inherits the same
 * URL shape.
 */
export function buildStableUrl(path: string, params: Record<string, string | number | undefined> = {}): string | null {
  const k = key();
  if (!k) return null;
  const url = new URL(`${FMP_STABLE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(name, String(value));
  }
  url.searchParams.set('apikey', k);
  return url.toString();
}

async function fmpFetchJson<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T | null> {
  const url = buildStableUrl(path, params);
  if (!url) {
    fmpLog.warn({ path }, 'fmp call skipped — FMP_API_KEY unset');
    return null;
  }
  try {
    const res = await fmpFetch(url);
    if (!res.ok) {
      // p6-14: distinguish 402 (paid tier) from generic 4xx/5xx so ops can
      // tell upstream-degraded from quota-blocked.
      fmpLog.warn(
        {
          path,
          status: res.status,
          paid_tier: res.status === 402,
          server_error: res.status >= 500,
        },
        'fmp non-2xx',
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    const cls = classifyFmpError(err);
    fmpLog.warn({ path, fail_mode: cls.mode, detail: cls.detail }, 'fmp fetch threw');
    return null;
  }
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
  if (!k) {
    fmpLog.warn({ path: '/quote', symbol }, 'fmp call skipped — FMP_API_KEY unset');
    return null;
  }
  const url = `${FMP_STABLE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) {
      fmpLog.warn({ path: '/quote', symbol, status: res.status, paid_tier: res.status === 402 }, 'fmp quote non-2xx');
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      fmpLog.debug({ path: '/quote', symbol }, 'fmp quote empty (legitimate no-data, not an error)');
      return null;
    }
    return data[0] as FmpQuote;
  } catch (err) {
    const cls = classifyFmpError(err);
    fmpLog.warn({ path: '/quote', symbol, fail_mode: cls.mode, detail: cls.detail }, 'fmp quote threw');
    return null;
  }
}

// /stable/quote's batch form (comma-separated symbols) is a paid-tier
// endpoint on the current FMP plan (returns 402). We fan-out single calls
// via Promise.all to keep the contract while staying within the standard
// quote quota. Callers that care about performance should cache upstream.
export async function getQuotes(symbols: string[]): Promise<FmpQuote[]> {
  if (symbols.length === 0) return [];
  const results = await Promise.all(symbols.map(s => getQuote(s)));
  return results.filter((q): q is FmpQuote => q !== null);
}

// ─── Profile ─────────────────────────────────────────────────────────

export interface FmpProfile {
  symbol: string;
  companyName?: string;
  price: number;
  marketCap: number;
  beta: number;
  lastDividend?: number;
  range?: string;
  change: number;
  industry?: string;
  sector?: string;
  country?: string;
  description?: string;
  website?: string;
  image?: string;
  ceo?: string;
  fullTimeEmployees?: string;
}

export async function getProfile(symbol: string): Promise<FmpProfile | null> {
  const k = key();
  if (!k) {
    fmpLog.warn({ path: '/profile', symbol }, 'fmp call skipped — FMP_API_KEY unset');
    return null;
  }
  const url = `${FMP_STABLE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) {
      fmpLog.warn({ path: '/profile', symbol, status: res.status, paid_tier: res.status === 402 }, 'fmp profile non-2xx');
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      fmpLog.debug({ path: '/profile', symbol }, 'fmp profile empty (legitimate no-data)');
      return null;
    }
    return data[0] as FmpProfile;
  } catch (err) {
    const cls = classifyFmpError(err);
    fmpLog.warn({ path: '/profile', symbol, fail_mode: cls.mode, detail: cls.detail }, 'fmp profile threw');
    return null;
  }
}

// ─── Stock price change (1D/5D/1M/3M/YTD/1Y/3Y/5Y/10Y/max %) ────────

export interface FmpStockPriceChange {
  symbol: string;
  '1D'?: number;
  '5D'?: number;
  '1M'?: number;
  '3M'?: number;
  '6M'?: number;
  ytd?: number;
  '1Y'?: number;
  '3Y'?: number;
  '5Y'?: number;
  '10Y'?: number;
  max?: number;
}

export async function getStockPriceChange(
  symbol: string,
): Promise<FmpStockPriceChange | null> {
  const k = key();
  if (!k) return null;
  const url = `${FMP_STABLE}/stock-price-change?symbol=${encodeURIComponent(symbol)}&apikey=${k}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as FmpStockPriceChange;
  } catch {
    return null;
  }
}

// ─── Historical prices (EOD OHLCV) ──────────────────────────────────

export interface FmpHistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change?: number;
  changePercent?: number;
  vwap?: number;
}

export interface FmpHistoricalResponse {
  symbol: string;
  /** Sorted descending by date (most recent first), matching /api/v3 shape. */
  historical: FmpHistoricalBar[];
}

/**
 * /stable replacement for the legacy `/api/v3/historical-price-full/{symbol}`
 * endpoint. Returns the same `{symbol, historical: [...]}` shape so call sites
 * that destructure `data.historical` continue to work.
 *
 * Options:
 *   `timeseries` — how many days back. Passed to FMP as `limit`. Undefined = full history.
 *   `light` — use the cheaper `historical-price-eod/light` endpoint (date + close + volume only).
 */
export async function getHistoricalPrices(
  symbol: string,
  options: { timeseries?: number; light?: boolean } = {},
): Promise<FmpHistoricalResponse | null> {
  const k = key();
  if (!k) return null;
  const variant = options.light ? 'light' : 'full';
  const qs = new URLSearchParams({ symbol, apikey: k });
  if (options.timeseries) qs.set('limit', String(options.timeseries));
  const url = `${FMP_STABLE}/historical-price-eod/${variant}?${qs.toString()}`;
  try {
    const res = await fmpFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const historical: FmpHistoricalBar[] = data.map((row: Record<string, unknown>) => ({
      date: String(row.date ?? ''),
      open: Number(row.open ?? row.price ?? 0),
      high: Number(row.high ?? row.price ?? 0),
      low: Number(row.low ?? row.price ?? 0),
      close: Number(row.close ?? row.price ?? 0),
      volume: Number(row.volume ?? 0),
      change: row.change != null ? Number(row.change) : undefined,
      changePercent:
        row.changePercent != null ? Number(row.changePercent) : undefined,
      vwap: row.vwap != null ? Number(row.vwap) : undefined,
    }));
    return { symbol, historical };
  } catch {
    return null;
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

// ─── Market movers (gainers / losers / actives) ─────────────────────
//
// /stable replacements for `/v3/stock_market/{gainers,losers,actives}`.
// Each returns a uniform "stock movers" row.

export interface StockMoverRow {
  symbol: string;
  name?: string;
  price: number;
  change?: number;
  changesPercentage?: number;
  volume?: number;
  [k: string]: unknown;
}

export async function getMarketGainers(): Promise<StockMoverRow[]> {
  const data = await fmpFetchJson<StockMoverRow[]>('/biggest-gainers');
  return Array.isArray(data) ? data : [];
}

export async function getMarketLosers(): Promise<StockMoverRow[]> {
  const data = await fmpFetchJson<StockMoverRow[]>('/biggest-losers');
  return Array.isArray(data) ? data : [];
}

export async function getMarketActives(): Promise<StockMoverRow[]> {
  const data = await fmpFetchJson<StockMoverRow[]>('/most-actives');
  return Array.isArray(data) ? data : [];
}

// ─── Stock screener ──────────────────────────────────────────────────

export interface StockScreenerRow {
  symbol: string;
  companyName?: string;
  price?: number;
  marketCap?: number;
  volume?: number;
  pe?: number;
  sector?: string;
  industry?: string;
  [k: string]: unknown;
}

export async function getStockScreener(params: {
  marketCapMoreThan?: number;
  priceMoreThan?: number;
  volumeMoreThan?: number;
  betaLowerThan?: number;
  betaMoreThan?: number;
  sector?: string;
  industry?: string;
  limit?: number;
}): Promise<StockScreenerRow[]> {
  // /stable replacement is `/company-screener`. Pass numeric params as strings.
  const data = await fmpFetchJson<StockScreenerRow[]>('/company-screener', params);
  return Array.isArray(data) ? data : [];
}

// ─── Earnings ────────────────────────────────────────────────────────

export interface EarningsCalendarRow {
  symbol?: string;
  companyName?: string;
  date?: string;
  time?: string;
  epsEstimated?: number;
  revenueEstimated?: number;
  [k: string]: unknown;
}

export async function getEarningsCalendar(from: string, to: string): Promise<EarningsCalendarRow[]> {
  const data = await fmpFetchJson<EarningsCalendarRow[]>('/earnings-calendar', { from, to });
  return Array.isArray(data) ? data : [];
}

export interface EarningsSurpriseRow {
  symbol?: string;
  date?: string;
  actualEarningResult?: number;
  estimatedEarning?: number;
  [k: string]: unknown;
}

export async function getEarningsSurprises(symbol: string): Promise<EarningsSurpriseRow[]> {
  const data = await fmpFetchJson<EarningsSurpriseRow[]>('/earnings-surprises', { symbol });
  return Array.isArray(data) ? data : [];
}

export async function getHistoricalEarnings(symbol: string, limit = 20): Promise<EarningsCalendarRow[]> {
  // /stable historical earnings collapsed to one endpoint with `symbol` + `limit`.
  const data = await fmpFetchJson<EarningsCalendarRow[]>('/earnings', { symbol, limit });
  return Array.isArray(data) ? data : [];
}

// ─── Dividends ───────────────────────────────────────────────────────

export interface DividendCalendarRow {
  symbol?: string;
  date?: string;
  yield?: number;
  adjDividend?: number;
  dividend?: number;
  [k: string]: unknown;
}

export async function getDividendCalendar(from: string, to: string): Promise<DividendCalendarRow[]> {
  const data = await fmpFetchJson<DividendCalendarRow[]>('/dividends-calendar', { from, to });
  return Array.isArray(data) ? data : [];
}

// ─── Treasury rates ──────────────────────────────────────────────────

export interface TreasuryRatesRow {
  date: string;
  year10?: number;
  year2?: number;
  year30?: number;
  year5?: number;
  year3?: number;
  year1?: number;
  month3?: number;
  month1?: number;
  [k: string]: unknown;
}

export async function getTreasuryRates(from: string, to: string): Promise<TreasuryRatesRow[]> {
  const data = await fmpFetchJson<TreasuryRatesRow[]>('/treasury-rates', { from, to });
  return Array.isArray(data) ? data : [];
}

// ─── Economic calendar ───────────────────────────────────────────────

export interface EconomicEventRow {
  date: string;
  event: string;
  country?: string;
  impact?: string;
  actual?: number | null;
  estimate?: number | null;
  previous?: number | null;
  [k: string]: unknown;
}

export async function getEconomicCalendar(from: string, to: string): Promise<EconomicEventRow[]> {
  const data = await fmpFetchJson<EconomicEventRow[]>('/economic-calendar', { from, to });
  return Array.isArray(data) ? data : [];
}

// ─── Insider & congressional trading ─────────────────────────────────

export interface InsiderTradingRow {
  symbol?: string;
  reportingName?: string;
  owner?: string;
  typeOfOwner?: string;
  acquistionOrDisposition?: string;
  transactionType?: string;
  securitiesTransacted?: number;
  shares?: number;
  price?: number;
  transactionDate?: string;
  filingDate?: string;
  link?: string;
  [k: string]: unknown;
}

export async function getInsiderTrades(symbol: string, limit = 100): Promise<InsiderTradingRow[]> {
  const data = await fmpFetchJson<InsiderTradingRow[]>('/insider-trading', { symbol, limit });
  return Array.isArray(data) ? data : [];
}

export async function getLatestInsiderTrades(limit = 50): Promise<InsiderTradingRow[]> {
  const data = await fmpFetchJson<InsiderTradingRow[]>('/insider-trading-latest', { limit });
  return Array.isArray(data) ? data : [];
}

export interface CongressTradeRow {
  ticker?: string;
  symbol?: string;
  representative?: string;
  firstName?: string;
  lastName?: string;
  party?: string;
  district?: string;
  type?: string;
  transactionType?: string;
  amount?: string;
  range?: string;
  transactionDate?: string;
  disclosureDate?: string;
  [k: string]: unknown;
}

export async function getSenateTrades(symbol: string): Promise<CongressTradeRow[]> {
  const data = await fmpFetchJson<CongressTradeRow[]>('/senate-trades', { symbol });
  return Array.isArray(data) ? data : [];
}

export async function getHouseTrades(symbol: string): Promise<CongressTradeRow[]> {
  const data = await fmpFetchJson<CongressTradeRow[]>('/house-trades', { symbol });
  return Array.isArray(data) ? data : [];
}

export async function getLatestSenateTrades(): Promise<CongressTradeRow[]> {
  const data = await fmpFetchJson<CongressTradeRow[]>('/senate-trades-latest');
  return Array.isArray(data) ? data : [];
}

export async function getLatestHouseTrades(): Promise<CongressTradeRow[]> {
  const data = await fmpFetchJson<CongressTradeRow[]>('/house-trades-latest');
  return Array.isArray(data) ? data : [];
}
