import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  content: z.string().describe('The memory or note to save'),
  category: z.enum(['strategy', 'rule', 'insight', 'preference']).optional().describe('Category for the memory'),
  symbol: z.string().optional().describe('Related stock ticker symbol (optional)'),
});

export const pinMemory: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'pin_memory',
  description: "Save a memory or note for future reference. Use when Wes says 'remember this', establishes a rule, or wants to note something for later.",
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'pin_memory',
    description: "Save a memory or note for future reference. Use when Wes says 'remember this', establishes a rule, or wants to note something for later.",
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The memory or note to save' },
        category: {
          type: 'string',
          enum: ['strategy', 'rule', 'insight', 'preference'],
          description: 'Category for the memory',
        },
        symbol: { type: 'string', description: 'Related stock ticker symbol (optional)' },
      },
      required: ['content'],
    },
  }),
  async execute(input) {
    const content = String(input.content || '').trim();
    if (!content) return { result: { error: 'Missing content' }, success: false };

    const category = input.category as string | undefined;
    const symbol = input.symbol ? sanitizeSymbol(String(input.symbol)) : null;

    const supabase = createServiceClient();
    const { data, error } = await supabase.from('keisha_memory_pins').insert({
      content,
      category: category || null,
      symbol,
      active: true,
      created_at: new Date().toISOString(),
    }).select('id');

    if (error) return { result: { error: error.message }, success: false };
    return {
      result: {
        message: 'Memory pinned',
        id: data?.[0]?.id,
        content,
        category: category || null,
        symbol,
      },
      success: true,
    };
  },
};
