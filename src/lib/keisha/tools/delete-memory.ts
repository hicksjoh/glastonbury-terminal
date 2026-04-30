import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { createServiceClient } from '@/lib/supabase';

const inputSchema = z.object({
  id: z.string().describe('ID of the memory pin to deactivate'),
});

export const deleteMemory: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'delete_memory',
  description: 'Remove a saved memory pin by setting it inactive.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'delete_memory',
    description: 'Remove a saved memory pin by setting it inactive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory pin to deactivate' },
      },
      required: ['id'],
    },
  }),
  async execute(input) {
    const id = String(input.id || '').trim();
    if (!id) return { result: { error: 'Missing memory id' }, success: false };

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('keisha_memory_pins')
      .update({ active: false })
      .eq('id', id);

    if (error) return { result: { error: error.message }, success: false };
    return { result: { message: 'Memory deactivated', id }, success: true };
  },
};
