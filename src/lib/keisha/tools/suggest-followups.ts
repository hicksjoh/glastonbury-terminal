import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';

const inputSchema = z.object({
  suggestions: z.array(z.string()).describe('Array of 3 short follow-up questions'),
});

// suggest_followups is a sentinel tool — the agent loop intercepts it to
// register UI suggestions and never calls executeToolCall for it.
// The execute stub here should never fire; it exists only so the tool
// appears in KEISHA_TOOLS (Anthropic schema).
export const suggestFollowups: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'suggest_followups',
  description: 'After answering, suggest 3 follow-up questions Wes might want to ask next. Always call this at the end of your response.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'suggest_followups',
    description: 'After answering, suggest 3 follow-up questions Wes might want to ask next. Always call this at the end of your response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of 3 short follow-up questions',
        },
      },
      required: ['suggestions'],
    },
  }),
  async execute(_input) {
    // Handled by agent loop — this stub is unreachable in normal operation.
    return { result: { noted: true }, success: true };
  },
};
