import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  limit: z.number().optional().describe('Number of top picks to return (default 3)'),
});

export const scanWatchlist: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'scan_watchlist',
  description: 'Scan all watchlist symbols for trading opportunities. Returns the top picks ranked by a quick momentum + value score.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'scan_watchlist',
    description: 'Scan all watchlist symbols for trading opportunities. Returns the top picks ranked by a quick momentum + value score.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Number of top picks to return (default 3)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 20);
    const supabase = createServiceClient();

    // 1. Get all watchlist symbols
    const { data: watchlistRows, error: wlError } = await supabase
      .from('watchlist')
      .select('symbol, buy_target, sell_target, notes');

    if (wlError || !watchlistRows || watchlistRows.length === 0) {
      return {
        result: { error: wlError?.message || 'Watchlist is empty' },
        success: !wlError,
      };
    }

    const symbols = watchlistRows.map((r: { symbol: string }) => r.symbol);
    const symbolsParam = symbols.join(',');

    // 2. Batch snapshot lookup
    const alpacaHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };

    const snapRes = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbolsParam}`,
      { headers: alpacaHeaders },
    );

    if (!snapRes.ok) {
      return { result: { error: `Alpaca snapshot failed: ${snapRes.status}` }, success: false };
    }

    const snapshots = await snapRes.json();

    // 3. Score each symbol
    const scored: {
      symbol: string;
      score: number;
      price: number;
      change: number;
      changePct: number;
      volume: number;
      buyTarget: number | null;
      sellTarget: number | null;
      notes: string | null;
      reasons: string[];
    }[] = [];

    for (const row of watchlistRows) {
      const sym = row.symbol as string;
      const snap = snapshots[sym];
      if (!snap) continue;

      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
      const prevClose = snap.prevDailyBar?.c ?? 0;
      const volume = snap.dailyBar?.v ?? 0;
      const change = price && prevClose ? +(price - prevClose).toFixed(2) : 0;
      const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;
      const buyTarget = (row as Record<string, unknown>).buy_target as number | null;
      const sellTarget = (row as Record<string, unknown>).sell_target as number | null;
      const notes = (row as Record<string, unknown>).notes as string | null;

      let score = 0;
      const reasons: string[] = [];

      // +2 momentum: price above previous close
      if (price > prevClose && prevClose > 0) {
        score += 2;
        reasons.push('momentum (above prev close)');
      }

      // +2 value: within 5% of buy target
      if (buyTarget && buyTarget > 0 && price > 0) {
        const distPct = Math.abs((price - buyTarget) / buyTarget) * 100;
        if (distPct <= 5) {
          score += 2;
          reasons.push(`near buy target ($${buyTarget})`);
        }
      }

      // +1 volume: > 1M shares
      if (volume > 1_000_000) {
        score += 1;
        reasons.push('high volume (>1M)');
      }

      scored.push({
        symbol: sym,
        score,
        price,
        change,
        changePct,
        volume,
        buyTarget,
        sellTarget,
        notes,
        reasons,
      });
    }

    // 4. Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    const topPicks = scored.slice(0, limit);

    return {
      result: { topPicks, totalScanned: symbols.length },
      success: true,
    };
  },
};
