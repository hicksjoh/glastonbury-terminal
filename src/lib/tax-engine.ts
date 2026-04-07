// ============================================================
// TAX ENGINE — US Federal Tax Calculator
// Source: IRS Revenue Procedure 2024-40 (Tax Year 2025)
// Updated: 2025-11-01
// IMPORTANT: Update TAX_YEAR_DATA annually by Feb 15
// ============================================================

export const TAX_DISCLAIMER =
  'Tax estimates are for educational and planning purposes only. This is NOT tax advice. ' +
  'Consult a qualified tax professional (CPA or EA) for your specific situation.';

// ─── Core Types ─────────────────────────────────────────────────────────────

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type TaxLotMethod = 'fifo' | 'lifo' | 'hifo' | 'specific';
export type GainType = 'short_term' | 'long_term';

export interface TaxBracket {
  rate: number;
  min: number;
  max: number; // Infinity for top bracket
}

export interface CapGainsThreshold {
  rate: number;
  min: number;
  max: number;
}

export interface TaxYearData {
  year: number;
  brackets: Record<FilingStatus, TaxBracket[]>;
  capitalGains: Record<FilingStatus, CapGainsThreshold[]>;
  standardDeduction: Record<FilingStatus, number>;
  niitThreshold: Record<FilingStatus, number>;
  niitRate: number;
  amtExemption: Record<FilingStatus, number>;
  amtPhaseout: Record<FilingStatus, number>;
  lossDeductionLimit: Record<FilingStatus, number>;
  estimatedTaxDates: { q1: string; q2: string; q3: string; q4: string };
  section1256Split: { longTerm: number; shortTerm: number };
  washSaleWindow: number;
  longTermThreshold: number;
  qualifiedDividendHoldingDays: number;
  qualifiedDividendWindow: number;
  retirementLimits: {
    traditional_ira: number;
    roth_ira: number;
    ira_catchup_50plus: number;
    k401: number;
    k401_catchup_50plus: number;
    k401_catchup_60_63: number;
    sep_ira_pct: number;
    sep_ira_max: number;
  };
  businessDeductions: {
    section179Limit: number;
    section179Phaseout: number;
    mileageRate: number;
    homeOfficeSimplifiedMax: number;
    homeOfficeRatePerSqft: number;
  };
}

// ============================================================
// 2025 TAX YEAR DATA (IRS Revenue Procedure 2024-40)
// ============================================================

export const TAX_2025: TaxYearData = {
  year: 2025,
  brackets: {
    single: [
      { rate: 0.10, min: 0, max: 11925 },
      { rate: 0.12, min: 11926, max: 48475 },
      { rate: 0.22, min: 48476, max: 103350 },
      { rate: 0.24, min: 103351, max: 197300 },
      { rate: 0.32, min: 197301, max: 250525 },
      { rate: 0.35, min: 250526, max: 375800 },
      { rate: 0.37, min: 375801, max: Infinity },
    ],
    mfj: [
      { rate: 0.10, min: 0, max: 23850 },
      { rate: 0.12, min: 23851, max: 96950 },
      { rate: 0.22, min: 96951, max: 206700 },
      { rate: 0.24, min: 206701, max: 394600 },
      { rate: 0.32, min: 394601, max: 501050 },
      { rate: 0.35, min: 501051, max: 751600 },
      { rate: 0.37, min: 751601, max: Infinity },
    ],
    mfs: [
      { rate: 0.10, min: 0, max: 11925 },
      { rate: 0.12, min: 11926, max: 48475 },
      { rate: 0.22, min: 48476, max: 103350 },
      { rate: 0.24, min: 103351, max: 206675 },
      { rate: 0.32, min: 206676, max: 313175 },
      { rate: 0.35, min: 313176, max: 375800 },
      { rate: 0.37, min: 375801, max: Infinity },
    ],
    hoh: [
      { rate: 0.10, min: 0, max: 15975 },
      { rate: 0.12, min: 15976, max: 61000 },
      { rate: 0.22, min: 61001, max: 194150 },
      { rate: 0.24, min: 194151, max: 383900 },
      { rate: 0.32, min: 383901, max: 487450 },
      { rate: 0.35, min: 487451, max: 731200 },
      { rate: 0.37, min: 731201, max: Infinity },
    ],
  },
  capitalGains: {
    single: [
      { rate: 0.00, min: 0, max: 48350 },
      { rate: 0.15, min: 48351, max: 533400 },
      { rate: 0.20, min: 533401, max: Infinity },
    ],
    mfj: [
      { rate: 0.00, min: 0, max: 96700 },
      { rate: 0.15, min: 96701, max: 600050 },
      { rate: 0.20, min: 600051, max: Infinity },
    ],
    mfs: [
      { rate: 0.00, min: 0, max: 48350 },
      { rate: 0.15, min: 48351, max: 300025 },
      { rate: 0.20, min: 300026, max: Infinity },
    ],
    hoh: [
      { rate: 0.00, min: 0, max: 64750 },
      { rate: 0.15, min: 64751, max: 566700 },
      { rate: 0.20, min: 566701, max: Infinity },
    ],
  },
  standardDeduction: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 },
  niitThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
  niitRate: 0.038,
  amtExemption: { single: 88100, mfj: 137000, mfs: 68500, hoh: 88100 },
  amtPhaseout: { single: 626350, mfj: 1252700, mfs: 626350, hoh: 626350 },
  lossDeductionLimit: { single: 3000, mfj: 3000, mfs: 1500, hoh: 3000 },
  estimatedTaxDates: {
    q1: '2026-04-15',
    q2: '2026-06-15',
    q3: '2026-09-15',
    q4: '2027-01-15',
  },
  section1256Split: { longTerm: 0.60, shortTerm: 0.40 },
  washSaleWindow: 61,
  longTermThreshold: 366,
  qualifiedDividendHoldingDays: 61,
  qualifiedDividendWindow: 121,
  retirementLimits: {
    traditional_ira: 7000,
    roth_ira: 7000,
    ira_catchup_50plus: 1000,
    k401: 23500,
    k401_catchup_50plus: 7500,
    k401_catchup_60_63: 11250,
    sep_ira_pct: 0.25,
    sep_ira_max: 70000,
  },
  businessDeductions: {
    section179Limit: 2500000,
    section179Phaseout: 4000000,
    mileageRate: 0.70,
    homeOfficeSimplifiedMax: 1500,
    homeOfficeRatePerSqft: 5,
  },
};

/** Active tax year pointer — update this when new year data is added */
export const ACTIVE_TAX_YEAR = TAX_2025;

// ============================================================
// CORE CALCULATION FUNCTIONS
// ============================================================

export interface IncomeTaxResult {
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  bracketBreakdown: { rate: number; taxableAtRate: number; tax: number }[];
}

/**
 * Calculate federal income tax for a given taxable income.
 */
export function calculateIncomeTax(
  taxableIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): IncomeTaxResult {
  const brackets = taxYear.brackets[filingStatus];
  let remaining = Math.max(0, taxableIncome);
  let totalTax = 0;
  let marginalRate = 0.10;
  const breakdown: { rate: number; taxableAtRate: number; tax: number }[] = [];

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const bracketWidth = bracket.max === Infinity ? remaining : bracket.max - bracket.min + 1;
    const taxableAtRate = Math.min(remaining, bracketWidth);
    const tax = taxableAtRate * bracket.rate;
    breakdown.push({ rate: bracket.rate, taxableAtRate, tax });
    totalTax += tax;
    remaining -= taxableAtRate;
    marginalRate = bracket.rate;
  }

  return {
    totalTax: Math.round(totalTax * 100) / 100,
    effectiveRate: taxableIncome > 0 ? Math.round((totalTax / taxableIncome) * 10000) / 10000 : 0,
    marginalRate,
    bracketBreakdown: breakdown,
  };
}

export interface CapGainsTaxResult {
  tax: number;
  effectiveRate: number;
  bracketBreakdown: { rate: number; amount: number; tax: number }[];
}

/**
 * Calculate capital gains tax on long-term gains.
 * Long-term gains stack on top of ordinary income for bracket purposes.
 */
export function calculateCapitalGainsTax(
  longTermGains: number,
  ordinaryIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): CapGainsTaxResult {
  const thresholds = taxYear.capitalGains[filingStatus];
  const taxableOrdinary = Math.max(0, ordinaryIncome - taxYear.standardDeduction[filingStatus]);
  let gainsRemaining = Math.max(0, longTermGains);
  let currentIncome = taxableOrdinary;
  let totalTax = 0;
  const breakdown: { rate: number; amount: number; tax: number }[] = [];

  for (const tier of thresholds) {
    if (gainsRemaining <= 0) break;
    const tierTop = tier.max === Infinity ? Infinity : tier.max;
    const spaceInTier = Math.max(0, tierTop - Math.max(currentIncome, tier.min) + 1);
    if (spaceInTier <= 0) continue;
    const taxedAtRate = Math.min(gainsRemaining, spaceInTier);
    const tax = taxedAtRate * tier.rate;
    breakdown.push({ rate: tier.rate, amount: taxedAtRate, tax });
    totalTax += tax;
    gainsRemaining -= taxedAtRate;
    currentIncome += taxedAtRate;
  }

  return {
    tax: Math.round(totalTax * 100) / 100,
    effectiveRate: longTermGains > 0 ? Math.round((totalTax / longTermGains) * 10000) / 10000 : 0,
    bracketBreakdown: breakdown,
  };
}

export interface NIITResult {
  niit: number;
  applies: boolean;
  excess: number;
}

/**
 * Calculate NIIT (3.8% Net Investment Income Tax).
 */
export function calculateNIIT(
  magi: number,
  netInvestmentIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): NIITResult {
  const threshold = taxYear.niitThreshold[filingStatus];
  const excess = Math.max(0, magi - threshold);
  const taxableAmount = Math.min(excess, netInvestmentIncome);
  const niit = Math.round(taxableAmount * taxYear.niitRate * 100) / 100;
  return { niit, applies: niit > 0, excess };
}

export interface HoldingPeriodResult {
  type: GainType;
  daysHeld: number;
  daysUntilLongTerm: number;
}

/**
 * Classify a trade as short-term or long-term based on holding period.
 */
export function classifyHoldingPeriod(
  buyDate: Date | string,
  sellDate: Date | string,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): HoldingPeriodResult {
  const buy = new Date(buyDate);
  const sell = new Date(sellDate);
  const daysHeld = Math.floor((sell.getTime() - buy.getTime()) / (1000 * 60 * 60 * 24));
  const isLongTerm = daysHeld >= taxYear.longTermThreshold;
  return {
    type: isLongTerm ? 'long_term' : 'short_term',
    daysHeld,
    daysUntilLongTerm: isLongTerm ? 0 : taxYear.longTermThreshold - daysHeld,
  };
}

export interface Section1256Result {
  totalTax: number;
  longTermPortion: number;
  shortTermPortion: number;
  longTermTax: number;
  shortTermTax: number;
  savings: number;
}

/**
 * Calculate Section 1256 contract tax (60/40 rule for futures & index options).
 */
export function calculateSection1256Tax(
  totalGain: number,
  ordinaryIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): Section1256Result {
  const { longTerm, shortTerm } = taxYear.section1256Split;
  const longTermPortion = totalGain * longTerm;
  const shortTermPortion = totalGain * shortTerm;

  const ltResult = calculateCapitalGainsTax(longTermPortion, ordinaryIncome, filingStatus, taxYear);
  const marginal = calculateIncomeTax(
    Math.max(0, ordinaryIncome + shortTermPortion - taxYear.standardDeduction[filingStatus]),
    filingStatus,
    taxYear,
  ).marginalRate;
  const stTax = shortTermPortion * marginal;

  // Compare to all-short-term treatment
  const allSTMarginal = calculateIncomeTax(
    Math.max(0, ordinaryIncome + totalGain - taxYear.standardDeduction[filingStatus]),
    filingStatus,
    taxYear,
  ).marginalRate;
  const allShortTermTax = totalGain * allSTMarginal;
  const savings = Math.round((allShortTermTax - (ltResult.tax + stTax)) * 100) / 100;

  return {
    totalTax: Math.round((ltResult.tax + stTax) * 100) / 100,
    longTermPortion: Math.round(longTermPortion * 100) / 100,
    shortTermPortion: Math.round(shortTermPortion * 100) / 100,
    longTermTax: ltResult.tax,
    shortTermTax: Math.round(stTax * 100) / 100,
    savings: Math.max(0, savings),
  };
}

export interface QuarterlyEstimateResult {
  quarterlyAmount: number;
  annualEstimate: number;
  safeHarbor: number;
  nextDueDate: string;
  remainingPayments: number;
}

/**
 * Estimate quarterly tax payment amounts.
 */
export function estimateQuarterlyPayment(
  ytdIncome: number,
  ytdTaxPaid: number,
  projectedAnnualIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): QuarterlyEstimateResult {
  const annualTax = calculateIncomeTax(
    Math.max(0, projectedAnnualIncome - taxYear.standardDeduction[filingStatus]),
    filingStatus,
    taxYear,
  ).totalTax;

  const safeHarbor = annualTax;
  const remainingTax = Math.max(0, annualTax - ytdTaxPaid);

  const now = new Date();
  const dates = taxYear.estimatedTaxDates;
  const dueDates = [dates.q1, dates.q2, dates.q3, dates.q4].map(d => new Date(d));
  const remaining = dueDates.filter(d => d > now);
  const remainingPayments = remaining.length || 1;
  const nextDueDate = remaining[0]?.toISOString().split('T')[0] ?? dates.q4;

  return {
    quarterlyAmount: Math.round((remainingTax / remainingPayments) * 100) / 100,
    annualEstimate: annualTax,
    safeHarbor,
    nextDueDate,
    remainingPayments,
  };
}

export interface HarvestOpportunityResult {
  taxSavings: number;
  offsetGains: number;
  offsetIncome: number;
  carryforward: number;
}

/**
 * Calculate tax-loss harvesting opportunity for a single position.
 */
export function calculateHarvestOpportunity(
  unrealizedLoss: number,
  ytdRealizedGains: number,
  marginalRate: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): HarvestOpportunityResult {
  const offsetGains = Math.min(Math.abs(unrealizedLoss), ytdRealizedGains);
  const remainingLoss = Math.abs(unrealizedLoss) - offsetGains;
  const lossLimit = taxYear.lossDeductionLimit[filingStatus];
  const offsetIncome = Math.min(remainingLoss, lossLimit);
  const carryforward = Math.max(0, remainingLoss - offsetIncome);

  const gainsSavings = offsetGains * marginalRate;
  const incomeSavings = offsetIncome * marginalRate;
  const taxSavings = Math.round((gainsSavings + incomeSavings) * 100) / 100;

  return { taxSavings, offsetGains, offsetIncome, carryforward };
}

export interface BracketInfoResult {
  currentBracket: number;
  nextBracketAt: number;
  roomInBracket: number;
}

/**
 * Get the user's current tax bracket info (marginal rate, room until next bracket).
 */
export function getTaxBracketInfo(
  taxableIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): BracketInfoResult {
  const brackets = taxYear.brackets[filingStatus];
  let currentBracket = 0.10;
  let nextBracketAt = 0;
  let roomInBracket = 0;

  for (const bracket of brackets) {
    if (taxableIncome >= bracket.min && (taxableIncome <= bracket.max || bracket.max === Infinity)) {
      currentBracket = bracket.rate;
      if (bracket.max === Infinity) {
        roomInBracket = Infinity;
        nextBracketAt = Infinity;
      } else {
        roomInBracket = bracket.max - taxableIncome;
        nextBracketAt = bracket.max + 1;
      }
      break;
    }
  }

  return { currentBracket, nextBracketAt, roomInBracket };
}

// ============================================================
// BUSINESS DEDUCTION CALCULATORS
// ============================================================

export interface Section179Result {
  deduction: number;
  phaseout: boolean;
  remaining: number;
}

/**
 * Calculate Section 179 immediate expensing deduction.
 */
export function calculateSection179(
  purchaseAmount: number,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): Section179Result {
  const { section179Limit, section179Phaseout } = taxYear.businessDeductions;
  const phaseoutExcess = Math.max(0, purchaseAmount - section179Phaseout);
  const adjustedLimit = Math.max(0, section179Limit - phaseoutExcess);
  const deduction = Math.min(purchaseAmount, adjustedLimit);
  return {
    deduction,
    phaseout: phaseoutExcess > 0,
    remaining: Math.max(0, purchaseAmount - deduction),
  };
}

export interface MileageResult {
  deduction: number;
  rate: number;
}

/**
 * Calculate standard mileage deduction for business use.
 */
export function calculateMileageDeduction(
  miles: number,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): MileageResult {
  const rate = taxYear.businessDeductions.mileageRate;
  return {
    deduction: Math.round(miles * rate * 100) / 100,
    rate,
  };
}

export interface HomeOfficeResult {
  deduction: number;
}

/**
 * Calculate home office deduction (simplified or regular method).
 */
export function calculateHomeOfficeDeduction(
  squareFeet: number,
  method: 'simplified' | 'regular' = 'simplified',
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): HomeOfficeResult {
  if (method === 'simplified') {
    const maxSqFt = taxYear.businessDeductions.homeOfficeSimplifiedMax / taxYear.businessDeductions.homeOfficeRatePerSqft;
    const usableSqFt = Math.min(squareFeet, maxSqFt);
    return {
      deduction: Math.round(usableSqFt * taxYear.businessDeductions.homeOfficeRatePerSqft * 100) / 100,
    };
  }
  // Regular method requires actual expenses — simplified placeholder
  return { deduction: 0 };
}

export interface SEPContributionResult {
  maxContribution: number;
  taxSavings: number;
}

/**
 * Calculate maximum SEP-IRA contribution and resulting tax savings.
 */
export function calculateSEPContribution(
  netSelfEmployment: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData = ACTIVE_TAX_YEAR,
): SEPContributionResult {
  const pctMax = netSelfEmployment * taxYear.retirementLimits.sep_ira_pct;
  const maxContribution = Math.min(pctMax, taxYear.retirementLimits.sep_ira_max);
  const marginal = calculateIncomeTax(
    Math.max(0, netSelfEmployment - taxYear.standardDeduction[filingStatus]),
    filingStatus,
    taxYear,
  ).marginalRate;
  const taxSavings = Math.round(maxContribution * marginal * 100) / 100;
  return { maxContribution: Math.round(maxContribution * 100) / 100, taxSavings };
}
