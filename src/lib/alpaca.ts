export const ALPACA_BASE_URL =
  process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY!;

/**
 * Hard-block any Alpaca order submission that isn't pointed at the paper
 * trading endpoint. This is a defense-in-depth check — env-config drift,
 * a copy-paste, or a typo on Vercel must NOT be enough to place real
 * orders against this terminal. Every order endpoint MUST funnel through
 * this guard before calling fetch().
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

const alpacaHeaders = {
  'APCA-API-KEY-ID': ALPACA_API_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
  'Content-Type': 'application/json',
};

export async function alpacaFetch(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${ALPACA_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...alpacaHeaders,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Alpaca API error: ${res.status} ${error}`);
  }
  return res.json();
}

export async function getAccount() {
  return alpacaFetch('/v2/account');
}

export async function getPositions() {
  return alpacaFetch('/v2/positions');
}

export async function getOrders(status = 'all', limit = 50) {
  return alpacaFetch(`/v2/orders?status=${status}&limit=${limit}`);
}

export async function submitOrder(order: {
  symbol: string;
  qty?: number;
  notional?: number;
  side: 'buy' | 'sell';
  // P0-4 widened to match the Alpaca + zod surface — stop and stop_limit
  // were already accepted at the schema layer, so the type just catches up.
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

export async function getLatestQuote(symbol: string) {
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
    headers: alpacaHeaders,
  });
  if (!res.ok) throw new Error(`Quote fetch failed for ${symbol}`);
  return res.json();
}

export async function searchAssets(query: string, limit = 10) {
  const assets = await alpacaFetch('/v2/assets?status=active&asset_class=us_equity');
  const q = query.toUpperCase();
  const matches = assets
    .filter((a: { symbol: string; name: string; tradable: boolean }) =>
      a.tradable && (a.symbol.startsWith(q) || a.name.toUpperCase().includes(q))
    )
    .sort((a: { symbol: string }, b: { symbol: string }) => {
      if (a.symbol === q) return -1;
      if (b.symbol === q) return 1;
      if (a.symbol.startsWith(q) && !b.symbol.startsWith(q)) return -1;
      if (!a.symbol.startsWith(q) && b.symbol.startsWith(q)) return 1;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit)
    .map((a: { symbol: string; name: string; exchange: string }) => ({
      symbol: a.symbol,
      name: a.name,
      exchange: a.exchange,
    }));
  return matches;
}

export async function getLatestTrade(symbol: string) {
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/trades/latest`, {
    headers: alpacaHeaders,
  });
  if (!res.ok) throw new Error(`Trade fetch failed for ${symbol}`);
  return res.json();
}

export async function getSnapshot(symbol: string) {
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/snapshot`, {
    headers: alpacaHeaders,
  });
  if (!res.ok) throw new Error(`Snapshot fetch failed for ${symbol}`);
  return res.json();
}
