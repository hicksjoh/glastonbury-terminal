import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import { TAX_DISCLAIMER, ACTIVE_TAX_YEAR, calculateIncomeTax, type FilingStatus } from '@/lib/tax-engine';

const inputSchema = z.object({
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).optional().describe('Filing status'),
});

export const getTaxSuggestions: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_tax_suggestions',
  description: 'Generate proactive tax optimization suggestions based on current portfolio, YTD trades, and time of year. Returns prioritized actionable recommendations.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_tax_suggestions',
    description: 'Generate proactive tax optimization suggestions based on current portfolio, YTD trades, and time of year. Returns prioritized actionable recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const sugFs = (String(input.filing_status || 'single')) as FilingStatus;
    const suggestions: Array<{
      priority: 'high' | 'medium' | 'low';
      category: string;
      title: string;
      description: string;
      potentialSavings?: number;
      deadline?: string;
      actionable: boolean;
    }> = [];

    const now = new Date();
    const month = now.getMonth() + 1; // 1-12

    // 1. Tax-Loss Harvesting — check for losses
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const harvestRes = await fetch(`${baseUrl}/api/tax/harvest?filing_status=${sugFs}&min_loss=500`, { signal: AbortSignal.timeout(10000) });
      if (harvestRes.ok) {
        const hd = await harvestRes.json();
        if (hd.data?.candidates?.length > 0) {
          suggestions.push({
            priority: 'high',
            category: 'harvest',
            title: 'Tax-Loss Harvesting Opportunity',
            description: `Found ${hd.data.candidates.length} position(s) with $${Math.abs(hd.data.totalUnrealizedLosses).toLocaleString()} in unrealized losses. Potential tax savings: $${hd.data.totalPotentialSavings.toLocaleString()}.`,
            potentialSavings: hd.data.totalPotentialSavings,
            actionable: true,
          });
        }
      }
    } catch { /* non-blocking */ }

    // 2. Quarterly Estimate reminder
    const quarterlyDates = ACTIVE_TAX_YEAR.estimatedTaxDates;
    for (const [q, dateStr] of Object.entries(quarterlyDates)) {
      const dueDate = new Date(dateStr);
      const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
      if (daysUntil > 0 && daysUntil <= 30) {
        suggestions.push({
          priority: 'high',
          category: 'quarterly',
          title: `${q.toUpperCase()} Estimated Tax Payment Due`,
          description: `Your quarterly estimated tax payment is due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dateStr}. Use get_tax_estimate to calculate the amount.`,
          deadline: dateStr,
          actionable: true,
        });
      }
    }

    // 3. Year-End Planning (Oct-Dec)
    if (month >= 10) {
      suggestions.push({
        priority: 'high',
        category: 'year_end',
        title: 'Year-End Tax Planning Window',
        description: 'Q4 is the best time to: (1) Accelerate tax losses before year-end, (2) Defer gains into next year if possible, (3) Max out retirement contributions, (4) Review estimated payments to avoid underpayment penalty.',
        actionable: true,
      });
    }

    // 4. Retirement Contributions
    const retLimits = ACTIVE_TAX_YEAR.retirementLimits;
    suggestions.push({
      priority: 'medium',
      category: 'retirement',
      title: 'Maximize Retirement Contributions',
      description: `${now.getFullYear()} limits: Traditional/Roth IRA: $${retLimits.traditional_ira.toLocaleString()}, 401(k): $${retLimits.k401.toLocaleString()}. Maxing your IRA reduces taxable income by $${retLimits.traditional_ira.toLocaleString()}.`,
      potentialSavings: Math.round(retLimits.traditional_ira * 0.24),
      actionable: true,
    });

    // 5. Business Deductions (Glastonbury Group)
    suggestions.push({
      priority: 'medium',
      category: 'business',
      title: 'Business Deduction Review',
      description: `As Glastonbury Group owner, review: Section 179 (up to $${ACTIVE_TAX_YEAR.businessDeductions.section179Limit.toLocaleString()}), home office deduction, vehicle mileage ($${ACTIVE_TAX_YEAR.businessDeductions.mileageRate}/mile), and SEP-IRA contributions (up to $${retLimits.sep_ira_max.toLocaleString()}).`,
      actionable: true,
    });

    // 6. Section 1256 reminder
    suggestions.push({
      priority: 'low',
      category: 'section_1256',
      title: 'Section 1256 Tax Advantage',
      description: 'If you trade futures or broad-based index options, they qualify for 60/40 long-term/short-term treatment regardless of holding period. Use calculate_section_1256 to see potential savings.',
      actionable: true,
    });

    // Sort by priority
    const prioOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority]);

    return {
      result: {
        suggestions,
        total: suggestions.length,
        generatedAt: now.toISOString(),
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
