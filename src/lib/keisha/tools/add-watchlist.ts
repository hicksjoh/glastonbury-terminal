import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';
import { getProfile } from '@/lib/fmp-client';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol to add'),
});

export const addWatchlist: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'add_watchlist',
  description: 'Add a stock symbol to the watchlist. Fetches company name and current price automatically.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'add_watchlist',
    description: 'Add a stock symbol to the watchlist. Fetches company name and current price automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol to add' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const supabase = createServiceClient();

    const { data: existing } = await supabase.from('watchlist')
      .select('id').eq('symbol', symbol).limit(1);

    if (existing && existing.length > 0) {
      return { result: { message: `${symbol} is already on your watchlist` }, success: true };
    }

    let companyName = symbol;
    let currentPrice = null;
    try {
      const profile = await getProfile(symbol);
      if (profile) {
        companyName = profile.companyName || symbol;
        currentPrice = profile.price;
      }
    } catch { /* non-critical */ }

    const { error } = await supabase.from('watchlist').insert({
      symbol,
      company_name: companyName,
      current_price: currentPrice,
    });

    if (error) return { result: { error: error.message }, success: false };
    return { result: { message: `Added ${symbol} (${companyName}) to watchlist` }, success: true };
  },
};
