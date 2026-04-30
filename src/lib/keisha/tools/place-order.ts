import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  side: z.enum(['buy', 'sell']).describe('Buy or sell'),
  qty: z.number().describe('Number of shares'),
  orderType: z.enum(['market', 'limit']).optional().describe('Order type (default: market)'),
  limitPrice: z.number().optional().describe('Limit price (required for limit orders)'),
  timeInForce: z.enum(['day', 'gtc', 'ioc']).optional().describe('Time in force (default: day)'),
});

// place_order is a DANGEROUS tool — it is handled directly by the agent loop
// (via createPendingConfirmation) and never reaches executeToolCall.
// This stub is here so the tool appears in KEISHA_TOOLS (Anthropic schema) and
// DANGEROUS_TOOLS (membership check). The execute function should never fire;
// if it somehow does, return a safe "pending" response.
export const placeOrder: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'place_order',
  description: 'Place a stock order (buy or sell). IMPORTANT: This executes a real trade. Only use when Wes explicitly asks to buy or sell shares.',
  inputSchema,
  dangerous: true,
  toAnthropicTool: (): Tool => ({
    name: 'place_order',
    description: 'Place a stock order (buy or sell). IMPORTANT: This executes a real trade. Only use when Wes explicitly asks to buy or sell shares.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Buy or sell' },
        qty: { type: 'number', description: 'Number of shares' },
        orderType: { type: 'string', enum: ['market', 'limit'], description: 'Order type (default: market)' },
        limitPrice: { type: 'number', description: 'Limit price (required for limit orders)' },
        timeInForce: { type: 'string', enum: ['day', 'gtc', 'ioc'], description: 'Time in force (default: day)' },
      },
      required: ['symbol', 'side', 'qty'],
    },
  }),
  // This execute stub should never fire — the agent loop intercepts dangerous tools
  // and routes them through createPendingConfirmation instead.
  async execute(_input) {
    return {
      result: {
        pending: true,
        message: 'Order requires Wes\'s confirmation. A confirmation prompt has been sent to the UI.',
      },
      success: false,
    };
  },
};
