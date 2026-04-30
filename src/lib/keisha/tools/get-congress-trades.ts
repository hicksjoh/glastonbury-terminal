import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';

const inputSchema = z.object({
  ticker: z.string().optional().describe('Optional ticker to filter by (e.g., NVDA)'),
});

export const getCongressTrades: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_congress_trades',
  description: 'Get recent congressional trades (Senate + House). Shows what politicians are buying and selling. Can filter by ticker. Use when Wes asks about Congress trading activity.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_congress_trades',
    description: 'Get recent congressional trades (Senate + House). Shows what politicians are buying and selling. Can filter by ticker. Use when Wes asks about Congress trading activity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker to filter by (e.g., NVDA)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const congressBaseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    try {
      const params = new URLSearchParams();
      const filterTicker = String(input.ticker || '').trim();
      if (filterTicker) params.set('ticker', sanitizeSymbol(filterTicker));
      const res = await fetch(`${congressBaseUrl}/api/congress?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { result: { error: `Congress API returned ${res.status}` }, success: false };
      }
      const congressData = await res.json();
      const congressTrades = (congressData.trades || []).slice(0, 15);
      return {
        result: {
          total: congressData.total || 0,
          trades: congressTrades.map((t: Record<string, unknown>) => ({
            politician: t.politician,
            party: t.party,
            ticker: t.ticker,
            type: t.transaction_type,
            amount: t.amount_range,
            date: t.date_traded,
          })),
        },
        success: true,
      };
    } catch (congressErr) {
      const congressMsg = congressErr instanceof Error ? congressErr.message : 'Congress fetch failed';
      return { result: { error: congressMsg }, success: false };
    }
  },
};
