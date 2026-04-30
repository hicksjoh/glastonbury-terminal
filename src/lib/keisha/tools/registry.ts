import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';

export interface ToolDef<TInput = unknown> {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<TInput, any, any>;
  toAnthropicTool: () => Tool;
  dangerous?: boolean;
  execute: (input: TInput) => Promise<{ result: unknown; success: boolean }>;
  buildRenderCard?: (input: TInput, result: unknown, success: boolean) => unknown | null;
}
