import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol to remove'),
});

export const removeWatchlist: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'remove_watchlist',
  description: 'Remove a stock symbol from the watchlist.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'remove_watchlist',
    description: 'Remove a stock symbol from the watchlist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol to remove' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const supabase = createServiceClient();
    const { error } = await supabase.from('watchlist').delete().eq('symbol', symbol);
    if (error) return { result: { error: error.message }, success: false };
    return { result: { message: `Removed ${symbol} from watchlist` }, success: true };
  },
};
