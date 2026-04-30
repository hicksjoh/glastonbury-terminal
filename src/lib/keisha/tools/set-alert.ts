import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  condition: z.enum(['price_above', 'price_below', 'pct_change']).describe('Alert condition type'),
  value: z.number().describe('Threshold value (price in dollars or percentage)'),
});

export const setAlert: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'set_alert',
  description: 'Set a price alert for a stock. Triggers when the condition is met.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'set_alert',
    description: 'Set a price alert for a stock. Triggers when the condition is met.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        condition: {
          type: 'string',
          enum: ['price_above', 'price_below', 'pct_change'],
          description: 'Alert condition type',
        },
        value: { type: 'number', description: 'Threshold value (price in dollars or percentage)' },
      },
      required: ['symbol', 'condition', 'value'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    const condition = String(input.condition || 'price_above');
    const value = parseFloat(String(input.value));

    if (!symbol || isNaN(value)) return { result: { error: 'Missing symbol or value' }, success: false };

    const supabase = createServiceClient();
    const { error } = await supabase.from('alerts').insert({
      name: `${symbol} ${condition.replace('_', ' ')} ${value}`,
      symbol,
      rules: [{ metric: condition.startsWith('pct') ? 'pct_change' : 'price', operator: condition.includes('above') || condition.includes('pct') ? '>' : '<', value }],
      logic: 'AND',
      active: true,
      created_at: new Date().toISOString(),
    });

    if (error) return { result: { error: error.message }, success: false };
    return { result: { message: `Alert set: ${symbol} ${condition.replace('_', ' ')} $${value}` }, success: true };
  },
};
