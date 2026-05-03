import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  ticker: z.string().optional().describe('Optional ticker'),
  topic_contains: z.string().optional().describe('Optional substring to match against the topic field'),
});

export const getResearchMemo: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_research_memo',
  description: 'Pull the latest deep-research memo for a ticker or topic from /research — 1500-5000 word buy-side memo with inline citations. Use when Wes asks about the research he\'s commissioned on a name.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_research_memo',
    description: 'Pull the latest deep-research memo for a ticker or topic from /research — 1500-5000 word buy-side memo with inline citations. Use when Wes asks about the research he\'s commissioned on a name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker' },
        topic_contains: { type: 'string', description: 'Optional substring to match against the topic field' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const ticker = String(input.ticker ?? '').toUpperCase();
    const topic = String(input.topic_contains ?? '');
    const sb = createServiceClient();
    let q = sb.from('deep_research_memos')
      .select('id, ticker, topic, memo_markdown, memo_word_count, sources_cited, total_cost_usd, status, created_at')
      .eq('user_id', 'wes').eq('status', 'completed')
      .order('created_at', { ascending: false }).limit(1);
    if (ticker) q = q.eq('ticker', ticker);
    if (topic) q = q.ilike('topic', `%${topic}%`);
    const { data } = await q;
    const row = (data as unknown as Array<{ id: string; ticker: string | null; topic: string; memo_markdown: string; memo_word_count: number | null; sources_cited: unknown }>)?.[0] ?? null;
    if (!row) return { result: { error: 'No matching research memo. Start one at /research', link: '/research' }, success: false };
    return {
      result: {
        id: row.id,
        ticker: row.ticker,
        topic: row.topic,
        word_count: row.memo_word_count,
        source_count: Array.isArray(row.sources_cited) ? row.sources_cited.length : 0,
        memo_preview: row.memo_markdown?.slice(0, 2000),
        link: `/research/${row.id}`,
      },
      success: true,
    };
  },
};
