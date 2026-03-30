const ALPACA_DATA_URL = 'https://data.alpaca.markets';

function getConfig() {
  return {
    baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
      'Content-Type': 'application/json',
    },
  };
}

export async function alpacaFetch(endpoint: string, options?: RequestInit) {
  const { baseUrl, headers } = getConfig();
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...headers,
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
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
}) {
  return alpacaFetch('/v2/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

export async function cancelAllOrders() {
  return alpacaFetch('/v2/orders', { method: 'DELETE' });
}

export async function getLatestQuote(symbol: string) {
  const { headers } = getConfig();
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
    headers,
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
  const { headers } = getConfig();
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/trades/latest`, {
    headers,
  });
  if (!res.ok) throw new Error(`Trade fetch failed for ${symbol}`);
  return res.json();
}

export async function getSnapshot(symbol: string) {
  const { headers } = getConfig();
  const res = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/snapshot`, {
    headers,
  });
  if (!res.ok) throw new Error(`Snapshot fetch failed for ${symbol}`);
  return res.json();
}
