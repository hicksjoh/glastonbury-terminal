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

export function useAlpacaWebSocket(symbols: string[]): UseAlpacaWebSocketReturn {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevClosesRef = useRef<Record<string, number>>({});
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const symbolsKey = symbols.sort().join(',');

  // Fetch previous closes for change calculation
  const fetchPrevCloses = useCallback(async (syms: string[]) => {
    try {
      const res = await fetch(`/api/prices/stream?symbols=${syms.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        const closes: Record<string, number> = {};
        for (const [sym, info] of Object.entries(data.prices || {})) {
          const p = info as any;
          if (p.price && p.changePercent !== undefined) {
            closes[sym] = p.price - p.change;
          }
        }
        prevClosesRef.current = closes;
      }
    } catch {
      // Use current prices as fallback
    }
  }, []);

  useEffect(() => {
    if (!symbolsKey || symbols.length === 0) return;

    const apiKey = process.env.NEXT_PUBLIC_ALPACA_API_KEY;
    const secretKey = process.env.NEXT_PUBLIC_ALPACA_SECRET_KEY;

    // If no client-side keys available, don't attempt WebSocket
    if (!apiKey || !secretKey) {
      setError('WebSocket keys not configured — using polling fallback');
      return;
    }

    // Fetch prev closes first
    fetchPrevCloses(symbols);

    const WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        // Authenticate
        ws.send(JSON.stringify({
          action: 'auth',
          key: apiKey,
          secret: secretKey,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const messages = JSON.parse(event.data);
          for (const msg of messages) {
            if (msg.T === 'success' && msg.msg === 'authenticated') {
              setConnected(true);
              setError(null);
              // Subscribe to trades
              ws.send(JSON.stringify({
                action: 'subscribe',
                trades: symbols,
              }));
            }

            if (msg.T === 'error') {
              setError(msg.msg || 'WebSocket error');
              setConnected(false);
            }

            // Trade update
            if (msg.T === 't') {
              const symbol = msg.S;
              const price = msg.p;
              const prevClose = prevClosesRef.current[symbol] || price;
              const change = price - prevClose;
              const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

              setPrices(prev => ({
                ...prev,
                [symbol]: { price, change, changePercent, timestamp: Date.now() },
              }));
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 5 seconds
        reconnectTimerRef.current = setTimeout(() => {
          if (symbols.length > 0) connect();
        }, 5000);
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
        setConnected(false);
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbolsKey, symbols, fetchPrevCloses]);

  // Update subscriptions when symbols change
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length > 0) {
      wsRef.current.send(JSON.stringify({
        action: 'subscribe',
        trades: symbols,
      }));
    }
  }, [symbolsKey, symbols]);

  return { prices, connected, error };
}
