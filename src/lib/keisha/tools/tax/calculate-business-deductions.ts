import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from '../registry';
import {
  TAX_DISCLAIMER,
  ACTIVE_TAX_YEAR,
  calculateIncomeTax,
  calculateMileageDeduction,
  calculateHomeOfficeDeduction,
  calculateSection179,
  calculateSEPContribution,
  type FilingStatus,
} from '@/lib/tax-engine';

const inputSchema = z.object({
  miles_driven: z.number().optional().describe('Business miles driven this year'),
  home_office_sqft: z.number().optional().describe('Dedicated home office square footage'),
  equipment_purchases: z.number().optional().describe('Business equipment purchased (Section 179)'),
  net_self_employment: z.number().optional().describe('Net self-employment income (for SEP-IRA calc)'),
});

export const calculateBusinessDeductions: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'calculate_business_deductions',
  description: 'Calculate business tax deductions — Section 179 expensing, mileage, home office, and SEP-IRA contributions for The Glastonbury Group.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'calculate_business_deductions',
    description: 'Calculate business tax deductions — Section 179 expensing, mileage, home office, and SEP-IRA contributions for The Glastonbury Group.',
    input_schema: {
      type: 'object' as const,
      properties: {
        miles_driven: { type: 'number', description: 'Business miles driven this year' },
        home_office_sqft: { type: 'number', description: 'Dedicated home office square footage' },
        equipment_purchases: { type: 'number', description: 'Business equipment purchased (Section 179)' },
        net_self_employment: { type: 'number', description: 'Net self-employment income (for SEP-IRA calc)' },
      },
      required: [],
    },
  }),
  async execute(input) {
    const miles = Number(input.miles_driven) || 0;
    const sqft = Number(input.home_office_sqft) || 0;
    const equipment = Number(input.equipment_purchases) || 0;
    const netSE = Number(input.net_self_employment) || 0;
    const bdFs = 'single' as FilingStatus;

    const mileage = calculateMileageDeduction(miles);
    const homeOffice = calculateHomeOfficeDeduction(sqft, 'simplified');
    const sec179 = calculateSection179(equipment);
    const sep = calculateSEPContribution(netSE, bdFs);

    const totalDeductions = mileage.deduction + homeOffice.deduction + sec179.deduction + sep.maxContribution;
    const marginalRate = calculateIncomeTax(
      Math.max(0, netSE - ACTIVE_TAX_YEAR.standardDeduction[bdFs]),
      bdFs,
    ).marginalRate;
    const totalTaxSavings = Math.round(totalDeductions * marginalRate * 100) / 100;

    return {
      result: {
        entity: 'The Glastonbury Group',
        mileage: {
          miles,
          rate: `$${mileage.rate}/mile`,
          deduction: mileage.deduction,
        },
        homeOffice: {
          squareFeet: sqft,
          method: 'simplified',
          deduction: homeOffice.deduction,
          note: sqft > 300 ? 'Simplified method caps at 300 sq ft ($1,500). Regular method may yield higher deduction.' : undefined,
        },
        section179: {
          purchaseAmount: equipment,
          deduction: sec179.deduction,
          phaseout: sec179.phaseout,
          remaining: sec179.remaining,
        },
        sepIRA: {
          netSelfEmployment: netSE,
          maxContribution: sep.maxContribution,
          taxSavings: sep.taxSavings,
        },
        summary: {
          totalDeductions,
          estimatedTaxSavings: totalTaxSavings,
          marginalRate: `${(marginalRate * 100).toFixed(0)}%`,
        },
        disclaimer: TAX_DISCLAIMER,
      },
      success: true,
    };
  },
};
