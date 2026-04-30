import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  query: z.string().optional().describe('Search query to filter memories by content'),
  symbol: z.string().optional().describe('Filter memories by stock ticker symbol'),
  limit: z.number().optional().describe('Max number of memories to return (default 10)'),
});

export const recallMemories: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'recall_memories',
  description: "Recall saved memories and notes. Use when Wes asks 'what did I say about X' or when you need to check a prior decision.",
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'recall_memories',
    description: "Recall saved memories and notes. Use when Wes asks 'what did I say about X' or when you need to check a prior decision.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query to filter memories by content' },
        symbol: { type: 'string', description: 'Filter memories by stock ticker symbol' },
        limit: { type: 'number', description: 'Max number of memories to return (default 10)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const query = input.query as string | undefined;
    const symbol = input.symbol ? sanitizeSymbol(String(input.symbol)) : undefined;
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);

    const supabase = createServiceClient();
    let q = supabase
      .from('keisha_memory_pins')
      .select('id, content, category, symbol, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (symbol) {
      q = q.eq('symbol', symbol);
    }
    if (query) {
      q = q.ilike('content', `%${query}%`);
    }

    const { data, error } = await q;
    if (error) return { result: { error: error.message }, success: false };
    return {
      result: { memories: data || [], count: data?.length || 0 },
      success: true,
    };
  },
};
