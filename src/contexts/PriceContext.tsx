'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  prevPrice?: number;
  updatedAt: number;
}

interface PriceContextType {
  prices: Record<string, PriceData>;
  subscribe: (symbols: string[]) => void;
  unsubscribe: (symbols: string[]) => void;
  connected: boolean;
}

const PriceContext = createContext<PriceContextType>({
  prices: {},
  subscribe: () => {},
  unsubscribe: () => {},
  connected: false,
});

export function usePrices() {
  return useContext(PriceContext);
}

export function usePriceForSymbol(symbol: string): PriceData | null {
  const { prices, subscribe, unsubscribe } = useContext(PriceContext);
  useEffect(() => {
    if (symbol) {
      subscribe([symbol]);
      return () => unsubscribe([symbol]);
    }
  }, [symbol, subscribe, unsubscribe]);
  return prices[symbol] || null;
}

const POLL_INTERVAL = 10_000; // 10 seconds

export function PriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [connected, setConnected] = useState(false);
  const subscribedRef = useRef<Map<string, number>>(new Map()); // symbol -> refCount
  const [subscribedSymbols, setSubscribedSymbols] = useState<string[]>([]);

  const subscribe = useCallback((symbols: string[]) => {
    let changed = false;
    symbols.forEach(s => {
      const current = subscribedRef.current.get(s) || 0;
      subscribedRef.current.set(s, current + 1);
      if (current === 0) changed = true;
    });
    if (changed) {
      setSubscribedSymbols(Array.from(subscribedRef.current.keys()));
    }
  }, []);

  const unsubscribe = useCallback((symbols: string[]) => {
    let changed = false;
    symbols.forEach(s => {
      const current = subscribedRef.current.get(s) || 0;
      if (current <= 1) {
        subscribedRef.current.delete(s);
        changed = true;
      } else {
        subscribedRef.current.set(s, current - 1);
      }
    });
    if (changed) {
      setSubscribedSymbols(Array.from(subscribedRef.current.keys()));
    }
  }, []);

  useEffect(() => {
    if (subscribedSymbols.length === 0) {
      setConnected(false);
      return;
    }

    let active = true;

    const fetchPrices = async () => {
      try {
        const symbols = subscribedSymbols.join(',');
        const res = await fetch(`/api/prices/stream?symbols=${encodeURIComponent(symbols)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (!active) return;
        setConnected(true);

        setPrices(prev => {
          const next = { ...prev };
          for (const [symbol, info] of Object.entries(data.prices || {})) {
            const p = info as { price: number; change: number; changePercent: number };
            const prevEntry = prev[symbol];
            next[symbol] = {
              price: p.price,
              change: p.change,
              changePercent: p.changePercent,
              prevPrice: prevEntry?.price,
              updatedAt: Date.now(),
            };
          }
          return next;
        });
      } catch {
        if (active) setConnected(false);
      }
    };

    // Fetch immediately, then every POLL_INTERVAL
    fetchPrices();
    const interval = setInterval(fetchPrices, POLL_INTERVAL);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [subscribedSymbols]);

  return (
    <PriceContext.Provider value={{ prices, subscribe, unsubscribe, connected }}>
      {children}
    </PriceContext.Provider>
  );
}
