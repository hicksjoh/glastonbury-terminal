import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { MiniChartCardData } from '@/types/keisha';

const inputSchema = z.object({
  ticker: z.string().describe('Stock ticker'),
  timeframe: z.enum(['1D', '5D', '1M', '3M', '6M', '1Y']).describe('Timeframe'),
});

export const miniChart: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'mini_chart',
  description: 'Return a small inline price sparkline widget for a ticker. Use it when Wes asks about price action and a visual helps. Pick an appropriate timeframe based on the question (1D for intraday, 1M for "past month", etc).',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'mini_chart',
    description: 'Return a small inline price sparkline widget for a ticker. Use it when Wes asks about price action and a visual helps. Pick an appropriate timeframe based on the question (1D for intraday, 1M for "past month", etc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        timeframe: { type: 'string', enum: ['1D', '5D', '1M', '3M', '6M', '1Y'], description: 'Timeframe' },
      },
      required: ['ticker', 'timeframe'],
    },
  }),
  async execute(input) {
    const sym = sanitizeSymbol(String(input.ticker ?? ''));
    const tf = String(input.timeframe ?? '1M') as '1D'|'5D'|'1M'|'3M'|'6M'|'1Y';
    if (!sym) return { result: { error: 'Need ticker' }, success: false };
    const { fetchBars } = await import('@/lib/crew-data');
    const tfMap: Record<string, { frame: string; limit: number }> = {
      '1D': { frame: '5Min',  limit: 78 },
      '5D': { frame: '30Min', limit: 65 },
      '1M': { frame: '1Day',  limit: 22 },
      '3M': { frame: '1Day',  limit: 65 },
      '6M': { frame: '1Day',  limit: 130 },
      '1Y': { frame: '1Day',  limit: 252 },
    };
    const cfg = tfMap[tf] ?? tfMap['1M'];
    const bars = await fetchBars(sym, cfg.frame, cfg.limit);
    if (bars.length === 0) return { result: { error: 'No bars returned' }, success: false };
    const closes = bars.map(b => b.c);
    const last = closes[closes.length - 1];
    const first = closes[0];
    const change_pct = ((last - first) / first) * 100;
    return { result: { ticker: sym, timeframe: tf, closes, last, change_pct }, success: true };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    return { type: 'mini_chart', data: r as unknown as MiniChartCardData };
  },
};
