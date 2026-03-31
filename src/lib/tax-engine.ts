/**
 * Tax Engine — 2026 Federal + CA State + NIIT + QBI + Wash Sale Detection
 */

export interface TaxEvent {
  date: string;
  type: 'realized_gain' | 'realized_loss' | 'rsu_vest' | 'dividend' | 'royalty_income' | 'expense_deduction';
  character: 'short_term' | 'long_term' | 'ordinary' | 'qbi';
  amount: number;
  ticker?: string;
  description?: string;
}

export interface WashSale {
  ticker: string;
  saleDate: string;
  expiresDate: string; // 30 days after sale
  amount: number;
  isActive: boolean;
}

export interface TaxSummary {
  totalIncome: number;
  shortTermGains: number;
  longTermGains: number;
  ordinaryIncome: number;
  qbiIncome: number;
  harvestedLosses: number;
  federalTax: number;
  stateTax: number;
  niit: number;
  qbiDeduction: number;
  totalTax: number;
  quarterlyEstimate: number;
  effectiveRate: number;
  marginalFederalRate: number;
  marginalStateRate: number;
  washSales: WashSale[];
}

// 2026 Federal Tax Brackets (estimated, single filer)
const FEDERAL_BRACKETS = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
];

// LTCG brackets (2026 estimated)
const LTCG_BRACKETS = [
  { min: 0, max: 47025, rate: 0.00 },
  { min: 47025, max: 518900, rate: 0.15 },
  { min: 518900, max: Infinity, rate: 0.20 },
];

// CA State Brackets (2026)
const CA_BRACKETS = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
  { min: 24684, max: 38959, rate: 0.04 },
  { min: 38959, max: 54081, rate: 0.06 },
  { min: 54081, max: 68350, rate: 0.08 },
  { min: 68350, max: 349137, rate: 0.093 },
  { min: 349137, max: 418961, rate: 0.103 },
  { min: 418961, max: 698271, rate: 0.113 },
  { min: 698271, max: 1000000, rate: 0.123 },
  { min: 1000000, max: Infinity, rate: 0.133 },
];

const NIIT_THRESHOLD = 250000; // Single filer MAGI threshold
const NIIT_RATE = 0.038;
const QBI_DEDUCTION_RATE = 0.20;

function calculateBracketTax(income: number, brackets: { min: number; max: number; rate: number }[]): number {
  let tax = 0;
  for (const bracket of brackets) {
    if (income <= bracket.min) break;
    const taxableInBracket = Math.min(income, bracket.max) - bracket.min;
    tax += taxableInBracket * bracket.rate;
  }
  return tax;
}

function getMarginalRate(income: number, brackets: { min: number; max: number; rate: number }[]): number {
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (income > brackets[i].min) return brackets[i].rate;
  }
  return brackets[0].rate;
}

export function detectWashSales(events: TaxEvent[]): WashSale[] {
  const sales = events
    .filter(e => e.type === 'realized_loss' && e.ticker)
    .sort((a, b) => a.date.localeCompare(b.date));

  const purchases = events
    .filter(e => e.type === 'realized_gain' && e.ticker)
    .sort((a, b) => a.date.localeCompare(b.date));

  const washSales: WashSale[] = [];

  for (const sale of sales) {
    const saleDate = new Date(sale.date);
    const windowStart = new Date(saleDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(saleDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const hasRepurchase = purchases.some(p =>
      p.ticker === sale.ticker &&
      new Date(p.date) >= windowStart &&
      new Date(p.date) <= windowEnd
    );

    if (hasRepurchase) {
      washSales.push({
        ticker: sale.ticker!,
        saleDate: sale.date,
        expiresDate: windowEnd.toISOString().slice(0, 10),
        amount: Math.abs(sale.amount),
        isActive: windowEnd > new Date(),
      });
    }
  }

  return washSales;
}

export function calculateTax(events: TaxEvent[]): TaxSummary {
  const shortTermGains = events
    .filter(e => e.type === 'realized_gain' && e.character === 'short_term')
    .reduce((sum, e) => sum + e.amount, 0);

  const longTermGains = events
    .filter(e => e.type === 'realized_gain' && e.character === 'long_term')
    .reduce((sum, e) => sum + e.amount, 0);

  const harvestedLosses = events
    .filter(e => e.type === 'realized_loss')
    .reduce((sum, e) => sum + Math.abs(e.amount), 0);

  const ordinaryIncome = events
    .filter(e => ['rsu_vest', 'dividend'].includes(e.type))
    .reduce((sum, e) => sum + e.amount, 0);

  const qbiIncome = events
    .filter(e => e.type === 'royalty_income' || e.character === 'qbi')
    .reduce((sum, e) => sum + e.amount, 0);

  const deductions = events
    .filter(e => e.type === 'expense_deduction')
    .reduce((sum, e) => sum + Math.abs(e.amount), 0);

  // Net gains after loss harvesting (max $3K excess loss deductible)
  const netSTGains = Math.max(shortTermGains - harvestedLosses, -3000);
  const totalOrdinary = ordinaryIncome + Math.max(netSTGains, 0) + qbiIncome - deductions;
  const qbiDeduction = qbiIncome * QBI_DEDUCTION_RATE;
  const taxableOrdinary = Math.max(0, totalOrdinary - qbiDeduction);

  // Federal tax on ordinary income
  const federalOrdinaryTax = calculateBracketTax(taxableOrdinary, FEDERAL_BRACKETS);

  // Federal LTCG tax
  const federalLTCGTax = calculateBracketTax(longTermGains, LTCG_BRACKETS);

  const federalTax = federalOrdinaryTax + federalLTCGTax;

  // CA state tax (all income taxed at ordinary rates)
  const totalStateIncome = taxableOrdinary + longTermGains;
  const stateTax = calculateBracketTax(totalStateIncome, CA_BRACKETS);

  // NIIT
  const investmentIncome = shortTermGains + longTermGains + events
    .filter(e => e.type === 'dividend')
    .reduce((sum, e) => sum + e.amount, 0);
  const niit = investmentIncome > NIIT_THRESHOLD ? (investmentIncome - NIIT_THRESHOLD) * NIIT_RATE : 0;

  const totalTax = Math.max(0, federalTax + stateTax + niit);
  const totalIncome = taxableOrdinary + longTermGains;

  const washSales = detectWashSales(events);

  return {
    totalIncome,
    shortTermGains,
    longTermGains,
    ordinaryIncome,
    qbiIncome,
    harvestedLosses,
    federalTax,
    stateTax,
    niit,
    qbiDeduction,
    totalTax,
    quarterlyEstimate: totalTax / 4,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    marginalFederalRate: getMarginalRate(taxableOrdinary, FEDERAL_BRACKETS),
    marginalStateRate: getMarginalRate(totalStateIncome, CA_BRACKETS),
    washSales,
  };
}
