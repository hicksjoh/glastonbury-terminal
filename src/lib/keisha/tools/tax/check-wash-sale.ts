import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { TAX_DISCLAIMER } from '@/lib/tax-engine';
import { getWashSalePreview, getUpcomingWindowCloses, scanPortfolioForWashSales, type TradeRecord } from '@/lib/wash-sale-detector';

const inputSchema = z.object({
  ticker: z.string().describe('Stock ticker to check'),
  action: z.enum(['buy', 'sell']).optional().describe('Proposed action'),
});

export const checkWashSale: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'check_wash_sale',
  description: 'Check if selling a position would trigger a wash sale based on recent trade history. Also checks for upcoming window closes where it becomes safe to rebuy.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'check_wash_sale',
    description: 'Check if selling a position would trigger a wash sale based on recent trade history. Also checks for upcoming window closes where it becomes safe to rebuy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker to check' },
        action: { type: 'string', enum: ['buy', 'sell'], description: 'Proposed action' },
      },
      required: ['ticker'],
    },
  }),
  async execute(input) {
    const ticker = sanitizeSymbol(String(input.ticker || ''));
    if (!ticker) return { result: { error: 'Missing ticker' }, success: false };
    const action = (String(input.action || 'sell')) as 'buy' | 'sell';

    // Fetch trade history from Alpaca
    const washAlpacaHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };
    const washBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    let washTrades: TradeRecord[] = [];
    try {
      const since = new Date();
      since.setMonth(since.getMonth() - 3);
      const fillsRes = await fetch(
        `${washBase}/v2/account/activities/FILL?after=${since.toISOString()}&direction=desc&page_size=200`,
        { headers: washAlpacaHeaders, signal: AbortSignal.timeout(10000) },
      );
      if (fillsRes.ok) {
        const fills = await fillsRes.json() as Array<{ id: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }>;
        washTrades = fills.map(f => ({
          id: f.id,
          ticker: f.symbol,
          action: f.side === 'buy' ? 'buy' as const : 'sell' as const,
          quantity: parseFloat(f.qty),
          price: parseFloat(f.price),
          date: f.transaction_time.split('T')[0],
        }));
      }
    } catch { /* continue with empty trades */ }

    const preview = getWashSalePreview(ticker, action, washTrades);
    const windowCloses = getUpcomingWindowCloses(washTrades).filter(a => a.ticker.toUpperCase() === ticker.toUpperCase());
    const allWashSales = scanPortfolioForWashSales(washTrades).filter(a => a.ticker.toUpperCase() === ticker.toUpperCase());

    return {
      result: {
        ticker,
        action,
        wouldTriggerWashSale: preview !== null,
        preview: preview ? {
          severity: preview.severity,
          message: preview.message,
          conflictingDate: preview.details.conflictingTrade?.date,
          disallowedLoss: preview.details.disallowedLoss,
          windowEnd: preview.details.windowEnd,
        } : null,
        existingWashSales: allWashSales.map(ws => ({
          severity: ws.severity,
          message: ws.message,
          conflictingDate: ws.details.conflictingTrade?.date,
          disallowedLoss: ws.details.disallowedLoss,
        })),
        upcomingWindowCloses: windowCloses.map(wc => ({
          message: wc.message,
          windowEnd: wc.details.windowEnd,
        })),
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
