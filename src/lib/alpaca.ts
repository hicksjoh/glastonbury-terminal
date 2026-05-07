// Alpaca client (p6-10 refactor).
//
// Codex audit findings (HIGH):
//   - Credentials were captured at module load (`const X = process.env.X!`).
//     Env rotation required a redeploy to pick up; missing env at cold-start
//     made every call throw with a confusing "undefined header value" error
//     instead of "ALPACA_API_KEY not set."
//   - alpacaFetch and the data-API helpers had no AbortSignal.timeout.
//     A slow Alpaca response could hang a Vercel function until the
//     platform's hard 10s/60s ceiling — by then the client gave up.
//   - Errors echoed raw upstream text including order IDs, account IDs,
//     and stack-y broker descriptions. Useful for debugging, hostile
//     for security review.
//
// Refactor:
//   - Helpers read env per request via getCreds() (cached for one call,
//     not at module load)
//   - Default 8s timeout (Vercel function default is 10s; leave 2s for
//     the rest of the handler), overridable per call
//   - Errors raise an AlpacaError carrying the upstream status, our own
//     code, and a public-safe message. Callers redact via the .public
//     accessor when responding to clients.

import { validateEquitySymbol } from '@/lib/sanitize';

export const ALPACA_BASE_URL =
  process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_DATA_URL = 'https://data.alpaca.markets';

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Hard-block any Alpaca order submission that isn't pointed at the paper
 * trading endpoint. Defense-in-depth — env-config drift, copy-paste, or
 * typo on Vercel must NOT be enough to place real orders. Every order
 * endpoint MUST funnel through this guard before calling fetch().
 */
const ALPACA_PAPER_HOST = 'paper-api.alpaca.markets';

export function assertPaperTrading(baseUrl: string = ALPACA_BASE_URL): void {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new Error(`Invalid ALPACA_BASE_URL: ${baseUrl}`);
  }
  if (host !== ALPACA_PAPER_HOST) {
    throw new Error(
      `Refusing to submit order: ALPACA_BASE_URL host is "${host}", ` +
        `expected "${ALPACA_PAPER_HOST}". This terminal is locked to paper trading. ` +
        `If you intend to enable live trading, remove this guard intentionally.`,
    );
  }
}

/** Public-safe Alpaca error. Don't include `upstreamBody` in API responses. */
export class AlpacaError extends Error {
  readonly status: number;
  readonly code: 'auth' | 'rate_limit' | 'timeout' | 'upstream' | 'config';
  readonly upstreamBody?: string;
  constructor(args: { status: number; code: AlpacaError['code']; message: string; upstreamBody?: string }) {
    super(args.message);
    this.name = 'AlpacaError';
    this.status = args.status;
    this.code = args.code;
    this.upstreamBody = args.upstreamBody;
  }
  /** Generic message safe to echo to the client. */
  public(): string {
    switch (this.code) {
      case 'auth': return 'Broker credentials misconfigured.';
      case 'rate_limit': return 'Broker rate limit hit; retry shortly.';
      case 'timeout': return 'Broker request timed out.';
      case 'config': return 'Broker not configured.';
      case 'upstream': default: return 'Broker request failed.';
    }
  }
}

interface Creds {
  key: string;
  secret: string;
  baseUrl: string;
}

function getCreds(): Creds {
  // Per-call env reads. If env was rotated, the next request picks up the
  // new value without waiting for a redeploy.
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) {
    throw new AlpacaError({
      status: 500,
      code: 'config',
      message: 'ALPACA_API_KEY and ALPACA_SECRET_KEY must be set',
    });
  }
  return {
    key,
    secret,
    baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
  };
}

function buildHeaders(creds: Creds): Record<string, string> {
  return {
    'APCA-API-KEY-ID': creds.key,
    'APCA-API-SECRET-KEY': creds.secret,
    'Content-Type': 'application/json',
  };
}

interface AlpacaFetchOptions extends RequestInit {
  /** Default 8s. Override per-call for slow endpoints (asset list ~3MB). */
  timeoutMs?: number;
  /** Default uses ALPACA_BASE_URL. Set to ALPACA_DATA_URL for market-data calls. */
  base?: 'trading' | 'data';
}

/**
 * Single fetch helper used by every Alpaca call. Adds:
 *   - per-call env read (no module-load credential caching)
 *   - AbortSignal.timeout (default 8s)
 *   - typed AlpacaError on failure (auth / rate_limit / timeout / upstream)
 *   - upstream body preserved on the error for Sentry but NOT echoed
 *     to the public response unless the caller explicitly opts in
 */
// Default T = any so existing callers (getAccount, getPositions, etc.)
// keep their unrestricted return shapes. Specific call sites pass T to
// narrow at use; in p6-15+ we'll add explicit return-type annotations.
// eslint-disable-next-line
export async function alpacaFetch<T = any>(
  endpoint: string,
  options: AlpacaFetchOptions = {},
): Promise<T> {
  const creds = getCreds();
  const base = options.base === 'data' ? ALPACA_DATA_URL : creds.baseUrl;
  const url = `${base}${endpoint}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...buildHeaders(creds), ...options.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'TimeoutError';
    throw new AlpacaError({
      status: isAbort ? 504 : 502,
      code: isAbort ? 'timeout' : 'upstream',
      message: isAbort ? `Alpaca timeout after ${timeoutMs}ms` : `Alpaca network error: ${(err as Error).message}`,
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let code: AlpacaError['code'];
    if (res.status === 401 || res.status === 403) code = 'auth';
    else if (res.status === 429) code = 'rate_limit';
    else code = 'upstream';
    throw new AlpacaError({
      status: res.status,
      code,
      message: `Alpaca ${res.status}`,
      upstreamBody: body.slice(0, 500),
    });
  }

  return res.json() as Promise<T>;
}

// ─── Account / positions / orders ─────────────────────────────────────────

export async function getAccount() {
  return alpacaFetch('/v2/account');
}

export async function getPositions() {
  return alpacaFetch('/v2/positions');
}

export async function getOrders(status = 'all', limit = 50) {
  const safeStatus = ['all', 'open', 'closed'].includes(status) ? status : 'all';
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500);
  return alpacaFetch(`/v2/orders?status=${safeStatus}&limit=${safeLimit}`);
}

export async function submitOrder(order: {
  symbol: string;
  qty?: number;
  notional?: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
}) {
  assertPaperTrading();
  return alpacaFetch('/v2/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

export async function cancelAllOrders() {
  return alpacaFetch('/v2/orders', { method: 'DELETE' });
}

// ─── Market data (validated symbols, data-API base) ───────────────────────

function validateSymbolOrThrow(symbol: string): string {
  const validated = validateEquitySymbol(symbol);
  if (!validated) {
    throw new AlpacaError({
      status: 400,
      code: 'config',
      message: `invalid equity symbol: ${symbol.slice(0, 20)}`,
    });
  }
  return validated;
}

export async function getLatestQuote(symbol: string) {
  const sym = validateSymbolOrThrow(symbol);
  return alpacaFetch(`/v2/stocks/${sym}/quotes/latest`, { base: 'data' });
}

export async function getLatestTrade(symbol: string) {
  const sym = validateSymbolOrThrow(symbol);
  return alpacaFetch(`/v2/stocks/${sym}/trades/latest`, { base: 'data' });
}

export async function getSnapshot(symbol: string) {
  const sym = validateSymbolOrThrow(symbol);
  return alpacaFetch(`/v2/stocks/${sym}/snapshot`, { base: 'data' });
}

// ─── Asset search (loose match for typeahead) ─────────────────────────────

/**
 * Asset search result. price/prevClose/change are optional enrichment
 * fields populated by the calling route when the query matches a single
 * exact symbol — they're not always present.
 */
export interface AssetSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  price?: number | null;
  prevClose?: number | null;
  change?: string | null;
}

export async function searchAssets(query: string, limit = 10): Promise<AssetSearchResult[]> {
  const assets = await alpacaFetch<Array<{ symbol: string; name: string; tradable: boolean; exchange: string }>>(
    '/v2/assets?status=active&asset_class=us_equity',
    { timeoutMs: 15_000 }, // ~3MB response, slow over cold start
  );
  const q = query.toUpperCase();
  const matches: AssetSearchResult[] = assets
    .filter(a => a.tradable && (a.symbol.startsWith(q) || a.name.toUpperCase().includes(q)))
    .sort((a, b) => {
      if (a.symbol === q) return -1;
      if (b.symbol === q) return 1;
      if (a.symbol.startsWith(q) && !b.symbol.startsWith(q)) return -1;
      if (!a.symbol.startsWith(q) && b.symbol.startsWith(q)) return 1;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit)
    .map(a => ({ symbol: a.symbol, name: a.name, exchange: a.exchange }));
  return matches;
}
