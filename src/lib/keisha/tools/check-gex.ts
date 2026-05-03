import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { runGEXAnalysis } from '@/lib/gex-engine';
import type { GEXCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock or ETF ticker symbol (e.g., SPY, AAPL, QQQ)'),
});

export const checkGex: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'check_gex',
  description: 'Check gamma exposure (GEX) levels and volatility regime for a symbol. Shows put wall, call wall, gamma flip point, high-volume level, net GEX, and whether dealers are suppressing or amplifying volatility. Use when Wes asks about GEX, gamma, dealer positioning, volatility expectations, or when analyzing options strategies.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'check_gex',
    description: 'Check gamma exposure (GEX) levels and volatility regime for a symbol. Shows put wall, call wall, gamma flip point, high-volume level, net GEX, and whether dealers are suppressing or amplifying volatility. Use when Wes asks about GEX, gamma, dealer positioning, volatility expectations, or when analyzing options strategies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock or ETF ticker symbol (e.g., SPY, AAPL, QQQ)' },
      },
      required: ['symbol'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || 'SPY'));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const gexResult = await runGEXAnalysis(symbol);
    return { result: gexResult, success: true };
  },
  buildRenderCard(input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.regime) return null;
    return {
      type: 'gex',
      data: {
        symbol: String(r.symbol || input.symbol || 'SPY'),
        spotPrice: Number(r.spotPrice || 0),
        netGEX: Number(r.netGEX || 0),
        regime: String(r.regime) as 'positive' | 'negative',
        impact: String(r.impact || ''),
        levels: {
          putWall: Number((r.levels as Record<string, unknown>)?.putWall || 0),
          callWall: Number((r.levels as Record<string, unknown>)?.callWall || 0),
          hvl: Number((r.levels as Record<string, unknown>)?.hvl || 0),
          gammaFlip: Number((r.levels as Record<string, unknown>)?.gammaFlip || 0),
          pinStrikes: ((r.levels as Record<string, unknown>)?.pinStrikes as number[]) || [],
        },
        dataSource: String(r.dataSource || 'synthetic'),
      } as GEXCardData,
    };
  },
};
