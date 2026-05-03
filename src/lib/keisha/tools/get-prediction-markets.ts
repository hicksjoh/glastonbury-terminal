import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';

const inputSchema = z.object({
  category: z.string().optional().describe('Optional category filter (e.g. "fed", "economy", "election")'),
});

export const getPredictionMarkets: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_prediction_markets',
  description: 'Get the latest Kalshi + Polymarket probability snapshots from /macro — curated markets on Fed decisions, CPI, recession odds, elections, etc. Each row has the Yes price, 24h delta, source, volume.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_prediction_markets',
    description: 'Get the latest Kalshi + Polymarket probability snapshots from /macro — curated markets on Fed decisions, CPI, recession odds, elections, etc. Each row has the Yes price, 24h delta, source, volume.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Optional category filter (e.g. "fed", "economy", "election")' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const { fetchLatestSnapshots } = await import('@/lib/prediction-markets');
    const category = String(input.category ?? '').toLowerCase();
    const all = await fetchLatestSnapshots();
    const filtered = category
      ? all.filter(s => (s.category ?? '').toLowerCase().includes(category) || s.market_name.toLowerCase().includes(category))
      : all;
    return {
      result: {
        count: filtered.length,
        markets: filtered.slice(0, 12).map(s => ({
          source: s.source,
          ticker: s.market_ticker,
          name: s.market_name,
          yes_pct: s.yes_price != null ? Math.round(s.yes_price * 100) : null,
          delta_24h_pp: s.delta_24h != null ? Math.round(s.delta_24h * 100) : null,
          volume_24h: s.volume_24h,
        })),
        link: '/macro',
      },
      success: true,
    };
  },
};
