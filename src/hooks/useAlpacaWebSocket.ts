'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface PriceUpdate {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

interface UseAlpacaWebSocketReturn {
  prices: Record<string, PriceUpdate>;
  connected: boolean;
  error: string | null;
}

const POLL_INTERVAL = 10_000; // 10s polling (replaces direct WS with leaked keys)

/**
 * Real-time price hook via server-side polling.
 * Previously used client-side WebSocket with NEXT_PUBLIC_ALPACA keys exposed
 * in the browser — a critical security risk. Now polls the server-side
 * /api/prices/stream endpoint which holds keys securely.
 */
export function useAlpacaWebSocket(symbols: string[]): UseAlpacaWebSocketReturn {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const symbolsKey = symbols.sort().join(',');

  const fetchPrices = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    try {
      const res = await fetch(`/api/prices/stream?symbols=${syms.join(',')}`);
      if (!res.ok) {
        setError(`Price fetch failed: ${res.status}`);
        setConnected(false);
        return;
      }
      const data = await res.json();
      setConnected(true);
      setError(null);

      const updates: Record<string, PriceUpdate> = {};
      for (const [sym, info] of Object.entries(data.prices || {})) {
        const p = info as { price?: number; change?: number; changePercent?: number };
        if (p.price) {
          updates[sym] = {
            price: p.price,
            change: p.change || 0,
            changePercent: p.changePercent || 0,
            timestamp: Date.now(),
          };
        }
      }
      setPrices(prev => ({ ...prev, ...updates }));
    } catch {
      setError('Price polling error');
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!symbolsKey || symbols.length === 0) return;

    // Fetch immediately
    fetchPrices(symbols);

    // Then poll
    intervalRef.current = setInterval(() => fetchPrices(symbols), POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [symbolsKey, symbols, fetchPrices]);

  return { prices, connected, error };
}
