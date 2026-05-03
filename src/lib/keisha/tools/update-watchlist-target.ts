import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  buyTarget: z.number().optional().describe('Target buy price'),
  sellTarget: z.number().optional().describe('Target sell price'),
  notes: z.string().optional().describe('Notes about this position'),
});

export const updateWatchlistTarget: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'update_watchlist_target',
  description: 'Update buy target, sell target, or notes for a watchlist symbol.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'update_watchlist_target',
    description: 'Update buy target, sell target, or notes for a watchlist symbol.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        buyTarget: { type: 'number', description: 'Target buy price' },
        sellTarget: { type: 'number', description: 'Target sell price' },
        notes: { type: 'string', description: 'Notes about this position' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const supabase = createServiceClient();
    const updates: Record<string, unknown> = {};
    if (input.buyTarget !== undefined) updates.buy_target = parseFloat(String(input.buyTarget));
    if (input.sellTarget !== undefined) updates.sell_target = parseFloat(String(input.sellTarget));
    if (input.notes !== undefined) updates.notes = input.notes;

    const { error } = await supabase.from('watchlist').update(updates).eq('symbol', symbol);
    if (error) return { result: { error: error.message }, success: false };
    return { result: { message: `Updated ${symbol} targets` }, success: true };
  },
};
