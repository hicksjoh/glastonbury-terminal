import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';

const inputSchema = z.object({
  symbols: z.array(z.string()).describe('Array of stock ticker symbols (max 20)'),
});

export const batchLookup: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'batch_lookup',
  description: 'Look up prices for multiple symbols at once. Use this instead of multiple lookup_price calls when comparing stocks or scanning candidates. Works 24/7 including after-hours.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'batch_lookup',
    description: 'Look up prices for multiple symbols at once. Use this instead of multiple lookup_price calls when comparing stocks or scanning candidates. Works 24/7 including after-hours.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of stock ticker symbols (max 20)',
        },
      },
      required: ['symbols'],
    },
  }),
  async execute(input) {
    const rawSymbols = input.symbols;
    if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
      return { result: { error: 'Missing or empty symbols array' }, success: false };
    }
    const symbols = rawSymbols.slice(0, 20).map((s) => sanitizeSymbol(String(s))).filter(Boolean);
    if (symbols.length === 0) return { result: { error: 'No valid symbols provided' }, success: false };

    const alpacaHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };

    const symbolsParam = symbols.join(',');

    // Fetch snapshots and 5-day bars in parallel
    const [snapRes, barsRes] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbolsParam}`, {
        headers: alpacaHeaders,
      }),
      fetch(
        `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbolsParam}&timeframe=1Day&limit=5`,
        { headers: alpacaHeaders },
      ),
    ]);

    if (!snapRes.ok) {
      return { result: { error: `Alpaca snapshot request failed: ${snapRes.status}` }, success: false };
    }

    const snapshots = await snapRes.json();

    // Parse bars response — keyed by symbol, each has an array of bars
    let barsData: Record<string, { c: number }[]> = {};
    if (barsRes.ok) {
      const barsJson = await barsRes.json();
      barsData = barsJson.bars || barsJson || {};
    }

    const now = new Date();
    const hour = now.getUTCHours();
    const isRegularHours = hour >= 13.5 && hour < 20;
    const session = isRegularHours ? 'regular' : 'extended';

    const results: Record<string, unknown> = {};
    for (const sym of symbols) {
      const snap = snapshots[sym];
      if (!snap) {
        results[sym] = { error: 'No data' };
        continue;
      }
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c;
      const prevClose = snap.prevDailyBar?.c;
      const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
      const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null;

      const symbolBars = barsData[sym] || [];
      const bars = symbolBars.map((b: { c: number }) => b.c);

      results[sym] = {
        price,
        change,
        changePct,
        volume: snap.dailyBar?.v ?? null,
        dayHigh: snap.dailyBar?.h ?? null,
        dayLow: snap.dailyBar?.l ?? null,
        prevClose,
        bidPrice: snap.latestQuote?.bp ?? null,
        askPrice: snap.latestQuote?.ap ?? null,
        session,
        bars,
      };
    }

    return { result: { results }, success: true };
  },
};
