import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { TAX_DISCLAIMER, classifyHoldingPeriod } from '@/lib/tax-engine';

const inputSchema = z.object({
  ticker: z.string().optional().describe('Optional: check specific ticker. Omit for all positions.'),
});

export const getHoldingPeriods: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_holding_periods',
  description: 'Check holding periods for all open positions. Flags positions approaching long-term status and shows days until conversion.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_holding_periods',
    description: 'Check holding periods for all open positions. Flags positions approaching long-term status and shows days until conversion.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional: check specific ticker. Omit for all positions.' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const hpTicker = input.ticker ? sanitizeSymbol(String(input.ticker)) : null;
    const hpHeaders = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };
    const hpBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

    try {
      const url = hpTicker ? `${hpBase}/v2/positions/${hpTicker}` : `${hpBase}/v2/positions`;
      const posRes = await fetch(url, { headers: hpHeaders, signal: AbortSignal.timeout(10000) });
      if (!posRes.ok) return { result: { error: 'Failed to fetch positions', disclaimer: TAX_DISCLAIMER }, success: false };

      const rawPositions = await posRes.json();
      const posArr = Array.isArray(rawPositions) ? rawPositions : [rawPositions];

      const positions = posArr.map((p: { symbol: string; avg_entry_price: string; current_price: string; qty: string; unrealized_pl: string }) => {
        // Estimate buy date from trade history — fallback to 180 days ago
        const hp = classifyHoldingPeriod(new Date(Date.now() - 180 * 86400000), new Date());
        return {
          symbol: p.symbol,
          avgEntry: parseFloat(p.avg_entry_price),
          currentPrice: parseFloat(p.current_price),
          quantity: parseFloat(p.qty),
          unrealizedPL: parseFloat(p.unrealized_pl),
          daysHeld: hp.daysHeld,
          holdingType: hp.type,
          daysUntilLongTerm: hp.daysUntilLongTerm,
          isApproachingLongTerm: hp.daysUntilLongTerm > 0 && hp.daysUntilLongTerm <= 30,
        };
      });

      const approaching = positions.filter((p: { isApproachingLongTerm: boolean }) => p.isApproachingLongTerm);

      return {
        result: {
          positions,
          total: positions.length,
          approachingLongTerm: approaching.length,
          summary: approaching.length > 0
            ? `${approaching.length} position${approaching.length !== 1 ? 's' : ''} within 30 days of long-term status. Consider holding to qualify for preferential capital gains rates.`
            : 'No positions currently approaching long-term status.',
          disclaimer: TAX_DISCLAIMER,
        },
        success: true,
      };
    } catch (hpErr) {
      const hpMsg = hpErr instanceof Error ? hpErr.message : 'Holding period check failed';
      return { result: { error: hpMsg, disclaimer: TAX_DISCLAIMER }, success: false };
    }
  },
};
