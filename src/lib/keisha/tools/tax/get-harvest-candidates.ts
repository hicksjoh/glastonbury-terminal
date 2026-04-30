import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { TAX_DISCLAIMER, type FilingStatus } from '@/lib/tax-engine';

const inputSchema = z.object({
  min_loss: z.number().optional().describe('Minimum unrealized loss to include (default $100)'),
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).optional().describe('Filing status for savings calc'),
});

export const getHarvestCandidates: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_harvest_candidates',
  description: 'Scan portfolio for tax-loss harvesting opportunities. Returns positions with unrealized losses, potential tax savings, and replacement security suggestions.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_harvest_candidates',
    description: 'Scan portfolio for tax-loss harvesting opportunities. Returns positions with unrealized losses, potential tax savings, and replacement security suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_loss: { type: 'number', description: 'Minimum unrealized loss to include (default $100)' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status for savings calc' },
      },
      required: [],
    },
  }),
  async execute(input) {
    try {
      const harvestFs = (String(input.filing_status || 'single')) as FilingStatus;
      const minLoss = Number(input.min_loss || 100);
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const harvestRes = await fetch(
        `${baseUrl}/api/tax/harvest?filing_status=${harvestFs}&min_loss=${minLoss}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!harvestRes.ok) {
        return { result: { error: 'Harvest scan failed', disclaimer: TAX_DISCLAIMER }, success: false };
      }
      const harvestData = await harvestRes.json();
      return { result: { ...harvestData.data, disclaimer: TAX_DISCLAIMER }, success: true };
    } catch (harvestErr) {
      const harvestMsg = harvestErr instanceof Error ? harvestErr.message : 'Harvest scan failed';
      return { result: { error: harvestMsg, disclaimer: TAX_DISCLAIMER }, success: false };
    }
  },
};
