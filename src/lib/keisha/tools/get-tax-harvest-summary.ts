import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  week_of: z.string().optional().describe('Optional Monday-of-week ISO date (YYYY-MM-DD). Defaults to the most recent.'),
});

export const getTaxHarvestSummary: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_tax_harvest_summary',
  description: 'Get this week\'s weekly tax-loss harvester output from /tax/harvest/weekly — total unrealized loss scanned, total estimated federal tax savings, per-position suggestions (loss + suggested ETF swap + wash-sale safety). Different from the inline harvest-candidates scan; this reads the persisted weekly run.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_tax_harvest_summary',
    description: 'Get this week\'s weekly tax-loss harvester output from /tax/harvest/weekly — total unrealized loss scanned, total estimated federal tax savings, per-position suggestions (loss + suggested ETF swap + wash-sale safety). Different from the inline harvest-candidates scan; this reads the persisted weekly run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        week_of: { type: 'string', description: 'Optional Monday-of-week ISO date (YYYY-MM-DD). Defaults to the most recent.' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const sb = createServiceClient();
    const week = String(input.week_of ?? '');
    let q = sb.from('tax_harvest_suggestions')
      .select('week_of, position_ticker, unrealized_loss, swap_candidate_ticker, swap_correlation, wash_sale_safe, estimated_tax_savings_usd, status, notes')
      .eq('user_id', 'wes')
      .order('week_of', { ascending: false }).order('unrealized_loss', { ascending: true }).limit(50);
    if (week) q = q.eq('week_of', week);
    const { data } = await q;
    const rows = (data as unknown as Array<{ week_of: string; unrealized_loss: number | null; estimated_tax_savings_usd: number | null; status: string }>) ?? [];
    const latestWeek = rows[0]?.week_of ?? null;
    const thisWeek = rows.filter(r => r.week_of === latestWeek);
    const totalLoss = thisWeek.reduce((s, r) => s + Math.abs(Number(r.unrealized_loss) || 0), 0);
    const totalSavings = thisWeek.reduce((s, r) => s + (Number(r.estimated_tax_savings_usd) || 0), 0);
    return {
      result: {
        week_of: latestWeek,
        suggestion_count: thisWeek.length,
        total_unrealized_loss_scanned: totalLoss,
        total_estimated_tax_savings_usd: totalSavings,
        suggestions: thisWeek.slice(0, 10),
        link: '/tax/harvest/weekly',
      },
      success: true,
    };
  },
};
