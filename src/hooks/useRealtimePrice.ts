'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface PriceEntry {
  price: number;
  change: number;
  changePercent: number;
}

interface UseRealtimePriceReturn {
  prices: Record<string, PriceEntry>;
  connected: boolean;
}

/**
 * Hook for real-time price streaming via polling.
 * Fetches latest quotes every `intervalMs` milliseconds.
 * For most use cases, prefer PriceContext instead — this hook
 * is a standalone alternative for components that need their
 * own independent polling cadence.
 */
export function useRealtimePrice(
  symbols: string[],
  intervalMs = 5000
): UseRealtimePriceReturn {
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [connected, setConnected] = useState(false);
  const symbolsKey = symbols.sort().join(',');
  const abortRef = useRef<AbortController | null>(null);

  const fetchPrices = useCallback(async () => {
    if (!symbolsKey) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/prices/stream?symbols=${encodeURIComponent(symbolsKey)}`,
        { signal: controller.signal }
      );
      if (!res.ok) {
        setConnected(false);
        return;
      }
      const data = await res.json();
      setConnected(true);

      const newPrices: Record<string, PriceEntry> = {};
      for (const [symbol, info] of Object.entries(data.prices || {})) {
        const p = info as PriceEntry;
        newPrices[symbol] = {
          price: p.price,
          change: p.change,
          changePercent: p.changePercent,
        };
      }
      setPrices(newPrices);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setConnected(false);
      }
    }
  }, [symbolsKey]);

  useEffect(() => {
    if (!symbolsKey) return;

    fetchPrices();
    const interval = setInterval(fetchPrices, intervalMs);

    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [symbolsKey, intervalMs, fetchPrices]);

  return { prices, connected };
}
