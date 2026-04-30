import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { OrderTicketCardData } from '@/types/keisha';

const inputSchema = z.object({
  ticker: z.string().describe('Stock ticker'),
  side: z.enum(['buy', 'sell']).describe('buy or sell'),
  qty: z.number().describe('Share count'),
  limit: z.number().optional().describe('Optional limit price; omit for market'),
});

export const orderTicket: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'order_ticket',
  description: 'Return an interactive order-ticket widget for a stock ticker. Use this when Wes asks "buy me X shares of TSLA" or wants to preview an order — the widget lets him review in the /trading page before executing. NEVER places the order; it only opens the ticket. Include a limit price if you have strong conviction; omit for market order.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'order_ticket',
    description: 'Return an interactive order-ticket widget for a stock ticker. Use this when Wes asks "buy me X shares of TSLA" or wants to preview an order — the widget lets him review in the /trading page before executing. NEVER places the order; it only opens the ticket. Include a limit price if you have strong conviction; omit for market order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy or sell' },
        qty: { type: 'number', description: 'Share count' },
        limit: { type: 'number', description: 'Optional limit price; omit for market' },
      },
      required: ['ticker', 'side', 'qty'],
    },
  }),
  async execute(input) {
    const sym = sanitizeSymbol(String(input.ticker ?? ''));
    const side = input.side === 'sell' ? 'sell' : 'buy';
    const qty = Math.max(0, Number(input.qty) || 0);
    const limit = input.limit != null ? Number(input.limit) : null;
    if (!sym || qty <= 0) return { result: { error: 'Need ticker and positive qty' }, success: false };
    // Pull last price for the card
    const { fetchQuote } = await import('@/lib/crew-data');
    const quote = await fetchQuote(sym);
    return {
      result: {
        ticker: sym,
        side,
        qty,
        limit,
        last_price: quote?.price ?? null,
        suggested_sizing: null,
        paperMode: process.env.ALPACA_PAPER === 'true' || (process.env.ALPACA_BASE_URL || '').includes('paper'),
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    return { type: 'order_ticket', data: r as unknown as OrderTicketCardData };
  },
};
