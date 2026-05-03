import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';

const inputSchema = z.object({});

export const getMarketNarrative: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_market_narrative',
  description: 'Get the latest AI-generated market narrative explaining what is happening in the market right now and why. Returns a concise, authoritative summary with sentiment, regime, and key price levels.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_market_narrative',
    description: 'Get the latest AI-generated market narrative explaining what is happening in the market right now and why. Returns a concise, authoritative summary with sentiment, regime, and key price levels.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  }),
  async execute(_input) {
    const narrativeBaseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    try {
      const res = await fetch(`${narrativeBaseUrl}/api/narrative`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        return { result: { error: `Narrative API returned ${res.status}` }, success: false };
      }
      const narrativeData = await res.json();
      return { result: narrativeData, success: true };
    } catch (fetchErr) {
      const fetchMsg = fetchErr instanceof Error ? fetchErr.message : 'Narrative fetch failed';
      return { result: { error: fetchMsg }, success: false };
    }
  },
};
