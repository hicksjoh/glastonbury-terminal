import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import {
  type FilingStatus,
  TAX_DISCLAIMER,
  ACTIVE_TAX_YEAR,
  calculateIncomeTax,
  calculateCapitalGainsTax,
  calculateNIIT,
  estimateQuarterlyPayment,
  getTaxBracketInfo,
} from '@/lib/tax-engine';

const inputSchema = z.object({
  ordinary_income: z.number().describe('Projected ordinary income for the year'),
  short_term_gains: z.number().optional().describe('Short-term capital gains (taxed as ordinary)'),
  long_term_gains: z.number().optional().describe('Long-term capital gains'),
  filing_status: z.enum(['single', 'mfj', 'mfs', 'hoh']).describe('Filing status'),
  ytd_tax_paid: z.number().optional().describe('Year-to-date tax already paid/withheld'),
});

export const getTaxEstimate: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'get_tax_estimate',
  description: 'Calculate estimated federal income tax and capital gains tax for a given income and filing status. Returns bracket breakdown, effective rate, marginal rate, NIIT, and quarterly estimates.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'get_tax_estimate',
    description: 'Calculate estimated federal income tax and capital gains tax for a given income and filing status. Returns bracket breakdown, effective rate, marginal rate, NIIT, and quarterly estimates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ordinary_income: { type: 'number', description: 'Projected ordinary income for the year' },
        short_term_gains: { type: 'number', description: 'Short-term capital gains (taxed as ordinary)' },
        long_term_gains: { type: 'number', description: 'Long-term capital gains' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
        ytd_tax_paid: { type: 'number', description: 'Year-to-date tax already paid/withheld' },
      },
      required: ['ordinary_income', 'filing_status'],
    },
  }),
  async execute(input) {
    const ordinaryIncome = Number(input.ordinary_income || 0);
    const stGains = Number(input.short_term_gains || 0);
    const ltGains = Number(input.long_term_gains || 0);
    const filingStatus = (String(input.filing_status || 'single')) as FilingStatus;
    const ytdPaid = Number(input.ytd_tax_paid || 0);

    const taxableOrdinary = Math.max(0, ordinaryIncome + stGains);
    const incomeTax = calculateIncomeTax(taxableOrdinary, filingStatus);
    const capGainsTax = calculateCapitalGainsTax(ltGains, taxableOrdinary, filingStatus);
    const niit = calculateNIIT(taxableOrdinary + ltGains, stGains + ltGains, filingStatus);
    const totalTax = incomeTax.totalTax + capGainsTax.tax + niit.niit;
    const bracketInfo = getTaxBracketInfo(taxableOrdinary, filingStatus);
    const quarterly = estimateQuarterlyPayment(taxableOrdinary + ltGains, ytdPaid, ordinaryIncome + stGains + ltGains, filingStatus);

    return {
      result: {
        filingStatus,
        ordinaryIncome,
        shortTermGains: stGains,
        longTermGains: ltGains,
        incomeTax: incomeTax.totalTax,
        capGainsTax: capGainsTax.tax,
        niit: niit.niit,
        niitApplies: niit.applies,
        totalEstimatedTax: totalTax,
        effectiveRate: (taxableOrdinary + ltGains) > 0 ? +(totalTax / (taxableOrdinary + ltGains) * 100).toFixed(2) : 0,
        marginalRate: +(bracketInfo.currentBracket * 100).toFixed(1),
        roomInBracket: bracketInfo.roomInBracket === Infinity ? 'unlimited' : bracketInfo.roomInBracket,
        nextBracketAt: bracketInfo.nextBracketAt === Infinity ? 'top bracket' : bracketInfo.nextBracketAt,
        bracketBreakdown: incomeTax.bracketBreakdown,
        quarterlyPayment: quarterly.quarterlyAmount,
        nextQuarterlyDue: quarterly.nextDueDate,
        standardDeduction: ACTIVE_TAX_YEAR.standardDeduction[filingStatus],
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
