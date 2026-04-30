import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { getQuote } from '@/lib/fmp-client';
import type { TradeCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol (e.g., AAPL, NVDA)'),
});

export const lookupPrice: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'lookup_price',
  description: 'Look up the current price, change, volume, and key stats for a stock symbol. Works 24/7 including pre-market and after-hours — returns bid/ask, session type, and last trade time. Use this whenever Wes asks about a stock price or you need current market data.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'lookup_price',
    description: 'Look up the current price, change, volume, and key stats for a stock symbol. Works 24/7 including pre-market and after-hours — returns bid/ask, session type, and last trade time. Use this whenever Wes asks about a stock price or you need current market data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol (e.g., AAPL, NVDA)' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const alpacaHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };

    // Primary: Alpaca snapshot — works 24/7 including after-hours
    try {
      const snapRes = await fetch(
        `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot`,
        { headers: alpacaHeaders },
      );

      if (snapRes.ok) {
        const snap = await snapRes.json();
        const price = snap.latestTrade?.p ?? snap.dailyBar?.c;
        const prevClose = snap.prevDailyBar?.c;
        const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
        const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null;

        // Determine market session
        const now = new Date();
        const hour = now.getUTCHours();
        const isRegularHours = hour >= 13.5 && hour < 20; // 9:30 AM - 4 PM ET
        const session = isRegularHours ? 'regular' : 'extended';

        const result: Record<string, unknown> = {
          symbol,
          price,
          change,
          changePct,
          volume: snap.dailyBar?.v ?? null,
          dayHigh: snap.dailyBar?.h ?? null,
          dayLow: snap.dailyBar?.l ?? null,
          prevClose,
          session,
          bidPrice: snap.latestQuote?.bp ?? null,
          askPrice: snap.latestQuote?.ap ?? null,
          lastTradeTime: snap.latestTrade?.t ?? null,
        };

        // Try FMP for extra stats (marketCap, yearHigh/Low) — non-blocking
        try {
          const q = await getQuote(symbol);
          if (q) {
            result.marketCap = q.marketCap;
            result.yearHigh = q.yearHigh;
            result.yearLow = q.yearLow;
            // FmpQuote from /stable does not expose `pe` — leave undefined.
          }
        } catch { /* FMP unavailable — Alpaca data is sufficient */ }

        return { result, success: true };
      }
    } catch (alpacaErr) {
      console.error(`Alpaca snapshot failed for ${symbol}:`, alpacaErr);
    }

    // Fallback: FMP /stable via fmp-client
    const quote = await getQuote(symbol);
    if (quote) {
      {
        return {
          result: {
            symbol,
            price: quote.price,
            change: quote.change,
            changePct: quote.changePercentage,
            volume: quote.volume,
            marketCap: quote.marketCap,
            dayHigh: quote.dayHigh,
            dayLow: quote.dayLow,
            yearHigh: quote.yearHigh,
            yearLow: quote.yearLow,
            session: 'unknown',
          },
          success: true,
        };
      }
    }

    return { result: { error: `No data available for ${symbol}` }, success: false };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.price) return null;
    return {
      type: 'trade',
      data: {
        symbol: String(r.symbol || _input.symbol || ''),
        currentPrice: Number(r.price),
        change: Number(r.change || 0),
        changePct: Number(r.changePct || 0),
      } as TradeCardData,
    };
  },
};
