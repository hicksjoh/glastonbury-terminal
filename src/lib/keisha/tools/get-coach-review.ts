import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  week_of: z.string().optional().describe('Optional Monday-of-week ISO date. Defaults to the most recent.'),
});

export const getCoachReview: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_coach_review',
  description: 'Get the latest weekly behavioral coach review — patterns detected (revenge trades, FOMO, size creep, etc), the primary rule for next week, and the review body. Use when Wes asks how he\'s trading, what patterns he\'s in, or what rule he should be following.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_coach_review',
    description: 'Get the latest weekly behavioral coach review — patterns detected (revenge trades, FOMO, size creep, etc), the primary rule for next week, and the review body. Use when Wes asks how he\'s trading, what patterns he\'s in, or what rule he should be following.',
    input_schema: {
      type: 'object' as const,
      properties: {
        week_of: { type: 'string', description: 'Optional Monday-of-week ISO date. Defaults to the most recent.' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const sb = createServiceClient();
    const week = String(input.week_of ?? '');
    let q = sb.from('coach_reviews')
      .select('week_of, review_markdown, patterns_detected, primary_rule_for_next_week, trade_count, pnl_usd, created_at')
      .eq('user_id', 'wes')
      .order('week_of', { ascending: false }).limit(1);
    if (week) q = q.eq('week_of', week);
    const { data } = await q;
    const row = (data as unknown as Array<{ week_of: string; review_markdown: string; patterns_detected: unknown; primary_rule_for_next_week: string; trade_count: number | null; pnl_usd: number | null }>)?.[0] ?? null;
    if (!row) return { result: { error: 'No coach reviews yet. Run one at /journal/coach.', link: '/journal/coach' }, success: false };
    return {
      result: {
        week_of: row.week_of,
        primary_rule_for_next_week: row.primary_rule_for_next_week,
        patterns_detected: row.patterns_detected,
        trade_count: row.trade_count,
        pnl_usd: row.pnl_usd,
        review_preview: row.review_markdown?.slice(0, 800),
        link: '/journal/coach',
      },
      success: true,
    };
  },
};
