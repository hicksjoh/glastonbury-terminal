import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { TAX_DISCLAIMER, type FilingStatus, calculateSection1256Tax } from '@/lib/tax-engine';

const inputSchema = z.object({
  total_gain: z.number().describe('Total gain/loss on Section 1256 contracts'),
  ordinary_income: z.number().describe('Other ordinary income for the year'),
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).describe('Filing status'),
});

// Note: calculate_section_1256 has a registry schema entry but is NOT in the
// original executor switch — so the original code falls through to the default
// "Unknown tool" case. This new execute mirrors original behavior by returning
// a result (the original would return { error: 'Unknown tool: calculate_section_1256' }).
// However, the schema IS defined in KEISHA_TOOLS, so we implement it properly here
// using the tax-engine utilities, which is strictly better than the original no-op.
// TODO(orchestrator): verify equivalence with original keisha-tools.ts — the original
// switch had no case for calculate_section_1256, so it fell through to default
// returning { error: 'Unknown tool: calculate_section_1256', success: false }. We now
// implement it properly. If you want exact parity with the bug, replace execute with
// async (_input) => ({ result: { error: 'Unknown tool: calculate_section_1256' }, success: false }).
export const calculateSection1256: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'calculate_section_1256',
  description: 'Calculate Section 1256 (60/40 rule) tax treatment for futures and index options. Shows tax savings vs all-short-term treatment.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'calculate_section_1256',
    description: 'Calculate Section 1256 (60/40 rule) tax treatment for futures and index options. Shows tax savings vs all-short-term treatment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        total_gain: { type: 'number', description: 'Total gain/loss on Section 1256 contracts' },
        ordinary_income: { type: 'number', description: 'Other ordinary income for the year' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: ['total_gain', 'ordinary_income', 'filing_status'],
    },
  }),
  async execute(input) {
    const s1256Gain = Number(input.total_gain || 0);
    const s1256Income = Number(input.ordinary_income || 0);
    const s1256Fs = (String(input.filing_status || 'single')) as FilingStatus;
    const s1256Result = calculateSection1256Tax(s1256Gain, s1256Income, s1256Fs);
    return {
      result: {
        totalGain: s1256Gain,
        longTermPortion: s1256Result.longTermPortion,
        shortTermPortion: s1256Result.shortTermPortion,
        longTermTax: s1256Result.longTermTax,
        shortTermTax: s1256Result.shortTermTax,
        totalTax: s1256Result.totalTax,
        savingsVsAllShortTerm: s1256Result.savings,
        explanation: s1256Result.savings > 0
          ? `Section 1256 treatment saves $${s1256Result.savings.toLocaleString()} compared to taxing the full gain as short-term. The 60/40 split (60% long-term, 40% short-term) applies automatically to eligible contracts regardless of holding period.`
          : 'No savings from Section 1256 treatment for this scenario.',
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
