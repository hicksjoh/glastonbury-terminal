import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { TAX_DISCLAIMER, type FilingStatus } from '@/lib/tax-engine';
import { compareLotMethods, type TaxLot } from '@/lib/tax-lot-optimizer';
import type { TradeRecord } from '@/lib/wash-sale-detector';

const inputSchema = z.object({
  ticker: z.string().describe('Stock ticker'),
  quantity: z.number().describe('Number of shares to sell'),
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).optional().describe('Filing status'),
});

export const compareTaxLots: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'compare_tax_lots',
  description: 'Compare FIFO, LIFO, and HIFO lot selection methods for selling a position. Shows tax impact of each method so user can pick the optimal one.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'compare_tax_lots',
    description: 'Compare FIFO, LIFO, and HIFO lot selection methods for selling a position. Shows tax impact of each method so user can pick the optimal one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        quantity: { type: 'number', description: 'Number of shares to sell' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: ['ticker', 'quantity'],
    },
  }),
  async execute(input) {
    const lotTicker = sanitizeSymbol(String(input.ticker || ''));
    if (!lotTicker) return { result: { error: 'Missing ticker' }, success: false };
    const lotQty = Number(input.quantity || 0);
    if (lotQty <= 0) return { result: { error: 'Quantity must be positive' }, success: false };
    const lotFs = (String(input.filing_status || 'single')) as FilingStatus;

    // Fetch positions and trade history for lot reconstruction
    const lotHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };
    const lotBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

    // Get current position for price
    let currentPrice = 0;
    try {
      const posRes = await fetch(`${lotBase}/v2/positions/${lotTicker}`, { headers: lotHeaders, signal: AbortSignal.timeout(10000) });
      if (posRes.ok) {
        const posData = await posRes.json();
        currentPrice = parseFloat(posData.current_price || '0');
      }
    } catch { /* use 0 */ }

    // Reconstruct lots from trade history (buys become lots)
    let lotTrades: TradeRecord[] = [];
    try {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 2);
      const fillsRes = await fetch(
        `${lotBase}/v2/account/activities/FILL?after=${since.toISOString()}&direction=asc&page_size=500`,
        { headers: lotHeaders, signal: AbortSignal.timeout(10000) },
      );
      if (fillsRes.ok) {
        const fills = await fillsRes.json() as Array<{ id: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }>;
        lotTrades = fills
          .filter(f => f.symbol.toUpperCase() === lotTicker.toUpperCase())
          .map(f => ({
            id: f.id,
            ticker: f.symbol,
            action: f.side === 'buy' ? 'buy' as const : 'sell' as const,
            quantity: parseFloat(f.qty),
            price: parseFloat(f.price),
            date: f.transaction_time.split('T')[0],
          }));
      }
    } catch { /* continue */ }

    // Build tax lots from buy history
    const buys = lotTrades.filter(t => t.action === 'buy');
    if (buys.length === 0) {
      return { result: { error: `No buy history found for ${lotTicker}. Cannot reconstruct tax lots.`, disclaimer: TAX_DISCLAIMER }, success: false };
    }

    const taxLots: TaxLot[] = buys.map((b, i) => ({
      id: `LOT-${i + 1}`,
      ticker: b.ticker,
      buyDate: new Date(b.date),
      quantity: b.quantity,
      costBasis: b.price,
      currentPrice,
    }));

    const comparison = compareLotMethods(taxLots, lotQty, { filingStatus: lotFs });
    return { result: { ...comparison, disclaimer: TAX_DISCLAIMER }, success: true };
  },
};
