'use client';

import { useAlpacaWebSocket } from './useAlpacaWebSocket';
import { useRealtimePrice } from './useRealtimePrice';

interface PriceEntry {
  price: number;
  change: number;
  changePercent: number;
}

/**
 * Smart price hook — uses Alpaca WebSocket for real-time streaming,
 * falls back to HTTP polling if WebSocket is unavailable.
 */
export function useSmartPrice(symbols: string[], pollingInterval = 10000) {
  const ws = useAlpacaWebSocket(symbols);
  const polling = useRealtimePrice(symbols, ws.connected ? 60000 : pollingInterval);

  // Merge: prefer WebSocket prices, fill gaps with polling
  const prices: Record<string, PriceEntry> = {};
  for (const sym of symbols) {
    if (ws.prices[sym]) {
      prices[sym] = {
        price: ws.prices[sym].price,
        change: ws.prices[sym].change,
        changePercent: ws.prices[sym].changePercent,
      };
    } else if (polling.prices[sym]) {
      prices[sym] = polling.prices[sym];
    }
  }

  return {
    prices,
    connected: ws.connected || polling.connected,
    streaming: ws.connected,
    error: ws.error,
  };
}
