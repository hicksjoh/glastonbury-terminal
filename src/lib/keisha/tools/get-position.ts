import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { TradeCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
});

export const getPosition: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_position',
  description: 'Get details on a specific position in the Alpaca brokerage account -- qty, market value, cost basis, unrealized P&L, avg entry price.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_position',
    description: 'Get details on a specific position in the Alpaca brokerage account -- qty, market value, cost basis, unrealized P&L, avg entry price.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    const res = await fetch(`${baseUrl}/v2/positions/${symbol}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
      },
    });

    if (!res.ok) return { result: { error: `No position in ${symbol}` }, success: false };

    const pos = await res.json();
    return {
      result: {
        symbol: pos.symbol,
        qty: parseFloat(pos.qty),
        marketValue: parseFloat(pos.market_value),
        costBasis: parseFloat(pos.cost_basis),
        unrealizedPl: parseFloat(pos.unrealized_pl),
        unrealizedPlPct: (parseFloat(pos.unrealized_plpc) * 100).toFixed(2) + '%',
        currentPrice: parseFloat(pos.current_price),
        avgEntry: parseFloat(pos.avg_entry_price),
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.symbol) return null;
    return {
      type: 'trade',
      data: {
        symbol: String(r.symbol),
        currentPrice: Number(r.currentPrice || 0),
        change: 0,
        changePct: 0,
        positionQty: Number(r.qty || 0),
        positionPnl: Number(r.unrealizedPl || 0),
        positionPnlPct: parseFloat(String(r.unrealizedPlPct || '0')),
      } as TradeCardData,
    };
  },
};
