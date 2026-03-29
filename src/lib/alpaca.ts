const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY!;

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
  const dataUrl = 'https://data.alpaca.markets';
  const res = await fetch(`${dataUrl}/v2/stocks/${symbol}/quotes/latest`, {
    headers: alpacaHeaders,
  });
  if (!res.ok) throw new Error(`Quote fetch failed for ${symbol}`);
  return res.json();
}
