import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  ticker: z.string().optional().describe('Optional ticker filter'),
  limit: z.number().optional().describe('Max rows (1-20, default 5)'),
});

export const getRecentCrewRuns: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_recent_crew_runs',
  description: 'List the most recent Trading Crew v2 verdicts — 4-specialist parallel analysis with an Opus judge synthesis. Returns ticker, verdict (BULL/BEAR/NEUTRAL/PASS), confidence, rationale, suggested trade, cost, latency. Optional ticker filter.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_recent_crew_runs',
    description: 'List the most recent Trading Crew v2 verdicts — 4-specialist parallel analysis with an Opus judge synthesis. Returns ticker, verdict (BULL/BEAR/NEUTRAL/PASS), confidence, rationale, suggested trade, cost, latency. Optional ticker filter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker filter' },
        limit: { type: 'number', description: 'Max rows (1-20, default 5)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const sb = createServiceClient();
    const ticker = String(input.ticker ?? '').toUpperCase();
    const limit = Math.max(1, Math.min(20, Number(input.limit ?? 5)));
    let q = sb.from('crew_runs')
      .select('id, ticker, judge_verdict, judge_confidence, judge_rationale, suggested_trade, total_cost_usd, total_latency_ms, created_at')
      .eq('user_id', 'wes').order('created_at', { ascending: false }).limit(limit);
    if (ticker) q = q.eq('ticker', ticker);
    const { data } = await q;
    return {
      result: {
        runs: (data as unknown as Array<Record<string, unknown>>) ?? [],
        filter_ticker: ticker || null,
        link: '/crew',
      },
      success: true,
    };
  },
};
