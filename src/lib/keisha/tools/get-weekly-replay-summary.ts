import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({});

export const getWeeklyReplaySummary: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_weekly_replay_summary',
  description: 'Get a weekly trading performance summary from AI trade replays. Returns average grades, total money left on table, most common lessons, best/worst trades. Use when Wes asks how he traded this week.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_weekly_replay_summary',
    description: 'Get a weekly trading performance summary from AI trade replays. Returns average grades, total money left on table, most common lessons, best/worst trades. Use when Wes asks how he traded this week.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  }),
  async execute(_input) {
    try {
      const replaySupabase = createServiceClient();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: replays, error: replaysErr } = await replaySupabase
        .from('trade_replays')
        .select('symbol, side, pnl, entry_grade, exit_grade, money_left_on_table, replay_data')
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(50);

      if (replaysErr) {
        return { result: { error: replaysErr.message }, success: false };
      }

      if (!replays || replays.length === 0) {
        return { result: { message: 'No trade replays from the past 7 days. Generate post-mortems from the Journal page first.' }, success: true };
      }

      const gradeVal: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
      const gradeFromVal = (v: number): string => {
        if (v >= 3.5) return 'A';
        if (v >= 2.5) return 'B';
        if (v >= 1.5) return 'C';
        if (v >= 0.5) return 'D';
        return 'F';
      };

      let entrySum = 0, exitSum = 0, totalLeft = 0, totalPnl = 0;
      let bestPnl = -Infinity, worstPnl = Infinity;
      let bestTrade = '', worstTrade = '';
      const lessons: string[] = [];

      for (const r of replays) {
        entrySum += gradeVal[r.entry_grade] || 2;
        exitSum += gradeVal[r.exit_grade] || 2;
        totalLeft += Number(r.money_left_on_table || 0);
        const pnl = Number(r.pnl || 0);
        totalPnl += pnl;
        if (pnl > bestPnl) { bestPnl = pnl; bestTrade = `${r.symbol} (${r.side})`; }
        if (pnl < worstPnl) { worstPnl = pnl; worstTrade = `${r.symbol} (${r.side})`; }
        const rd = r.replay_data as Record<string, unknown> | null;
        if (rd?.lesson) lessons.push(String(rd.lesson));
      }

      const count = replays.length;
      return {
        result: {
          tradeCount: count,
          avgEntryGrade: gradeFromVal(entrySum / count),
          avgExitGrade: gradeFromVal(exitSum / count),
          totalMoneyLeftOnTable: Math.round(totalLeft),
          totalPnl: Math.round(totalPnl),
          bestTrade: `${bestTrade} ($${bestPnl.toFixed(0)})`,
          worstTrade: `${worstTrade} ($${worstPnl.toFixed(0)})`,
          topLessons: lessons.slice(0, 3),
        },
        success: true,
      };
    } catch (replayErr) {
      const replayMsg = replayErr instanceof Error ? replayErr.message : 'Weekly summary failed';
      return { result: { error: replayMsg }, success: false };
    }
  },
};
