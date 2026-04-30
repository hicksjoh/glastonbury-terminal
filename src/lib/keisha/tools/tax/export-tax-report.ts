import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { TAX_DISCLAIMER } from '@/lib/tax-engine';
import { generateForm8949Data, exportForm8949CSV, generateScheduleDSummary } from '@/lib/tax-export';
import type { TradeRecord } from '@/lib/wash-sale-detector';

const inputSchema = z.object({
  tax_year: z.number().optional().describe('Tax year to export (default: current year)'),
});

export const exportTaxReport: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'export_tax_report',
  description: 'Generate a Form 8949-compatible CSV export of all realized trades for a tax year. Perfect for sending to your CPA. Returns CSV data and Schedule D summary.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'export_tax_report',
    description: 'Generate a Form 8949-compatible CSV export of all realized trades for a tax year. Perfect for sending to your CPA. Returns CSV data and Schedule D summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tax_year: { type: 'number', description: 'Tax year to export (default: current year)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const taxYear = Number(input.tax_year) || new Date().getFullYear();
    const alpacaBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    const alpHdrs = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };

    // Fetch 2 years of trades to capture buys before tax year
    const since = new Date(taxYear - 1, 0, 1);
    const tradeRes = await fetch(
      `${alpacaBase}/v2/account/activities/FILL?after=${since.toISOString().split('T')[0]}T00:00:00Z&direction=asc&page_size=1000`,
      { headers: alpHdrs, signal: AbortSignal.timeout(15000) },
    );

    if (!tradeRes.ok) {
      return { result: { error: 'Failed to fetch trade history from Alpaca' }, success: false };
    }

    const rawTrades: Array<{ id: string; activity_type: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }> = await tradeRes.json();
    const allTrades: TradeRecord[] = rawTrades
      .filter(a => a.activity_type === 'FILL')
      .map(a => ({
        id: a.id,
        ticker: a.symbol,
        action: a.side === 'buy' ? 'buy' as const : 'sell' as const,
        quantity: parseFloat(a.qty),
        price: parseFloat(a.price),
        date: a.transaction_time.split('T')[0],
      }));

    const form8949 = generateForm8949Data(allTrades, taxYear);
    const scheduleDSummary = generateScheduleDSummary(form8949);
    const csv = exportForm8949CSV(form8949);

    return {
      result: {
        taxYear,
        totalTrades: form8949.length,
        scheduleDSummary,
        csvPreview: csv.split('\n').slice(0, 6).join('\n') + (form8949.length > 5 ? '\n...' : ''),
        fullCSV: csv,
        message: `Generated Form 8949 report for ${taxYear} with ${form8949.length} trade(s). Schedule D summary: Net ${scheduleDSummary.totalNet >= 0 ? 'gain' : 'loss'} of $${Math.abs(scheduleDSummary.totalNet).toLocaleString()}.${scheduleDSummary.washSaleAdjustments > 0 ? ` Wash sale adjustments: $${scheduleDSummary.washSaleAdjustments.toLocaleString()}.` : ''}`,
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
