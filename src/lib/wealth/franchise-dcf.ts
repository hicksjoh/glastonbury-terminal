// F4 — CR3 franchise DCF model.
//
// Treats Wes's 23 CR3 American Exteriors territories as a single
// franchise-operations portfolio. Computes 5-year projected revenue +
// EBITDA + free cash flow, then discounts back to a present value with
// a comp-multiple terminal sanity check.
//
// All assumptions are overridable via the route's optional query params
// so Wes can stress-test "what if Naples 2x's" or "what if I sell 17 of
// the 23 territories" without recompiling.

export interface DcfInputs {
  /** Total operating territories (default 23 = 13 Seacoast + 10 West Coast). */
  territories: number;
  /** Year-1 revenue per average territory (default $74K — CR3 baseline). */
  avgRevenuePerTerritoryUSD: number;
  /** Top-performer multiplier (default 1.5 — Naples/Boca/Sarasota tier). */
  topPerformerMultiple: number;
  /** Count of top-performer territories (default 5). */
  topPerformerCount: number;
  /** Year-1 EBITDA margin (default 0.30 = 30%). */
  ebitdaMargin: number;
  /** Annual revenue growth across the projection horizon (default 0.30). */
  revenueGrowth: number;
  /** Discount rate (default 0.15 = 15% — typical small-franchise WACC). */
  discountRate: number;
  /** Terminal EV/EBITDA multiple (default 8x — franchise comp range). */
  terminalEvEbitdaMultiple: number;
  /** Years to project before applying terminal value (default 5). */
  projectionYears: number;
}

export const DCF_DEFAULTS: DcfInputs = {
  territories: 23,
  avgRevenuePerTerritoryUSD: 74_000,
  topPerformerMultiple: 1.5,
  topPerformerCount: 5,
  ebitdaMargin: 0.30,
  revenueGrowth: 0.30,
  discountRate: 0.15,
  terminalEvEbitdaMultiple: 8,
  projectionYears: 5,
};

export interface DcfYearProjection {
  year: number;
  revenue: number;
  ebitda: number;
  freeCashFlow: number;
  presentValue: number;
}

export interface DcfResult {
  inputs: DcfInputs;
  yearOneRevenue: number;
  yearOneEbitda: number;
  projection: DcfYearProjection[];
  terminalValue: number;
  terminalPresentValue: number;
  enterpriseValue: number;
  comparableValueRange: { low: number; mid: number; high: number };
  /** Sanity-check: enterprise value as a multiple of year-1 EBITDA. */
  evToYearOneEbitda: number;
}

export function runFranchiseDcf(overrides: Partial<DcfInputs> = {}): DcfResult {
  const inputs: DcfInputs = { ...DCF_DEFAULTS, ...overrides };

  const baseTerritories = Math.max(0, inputs.territories - inputs.topPerformerCount);
  const yearOneRevenue =
    baseTerritories * inputs.avgRevenuePerTerritoryUSD +
    inputs.topPerformerCount * inputs.avgRevenuePerTerritoryUSD * inputs.topPerformerMultiple;

  const projection: DcfYearProjection[] = [];
  let revenue = yearOneRevenue;
  for (let y = 1; y <= inputs.projectionYears; y++) {
    if (y > 1) revenue = revenue * (1 + inputs.revenueGrowth);
    const ebitda = revenue * inputs.ebitdaMargin;
    // Use EBITDA as a proxy for FCF — franchise operations are
    // capital-light enough that working-capital + tax adjustments
    // wash out for a back-of-envelope DCF.
    const freeCashFlow = ebitda;
    const presentValue = freeCashFlow / Math.pow(1 + inputs.discountRate, y);
    projection.push({
      year: y,
      revenue: Math.round(revenue),
      ebitda: Math.round(ebitda),
      freeCashFlow: Math.round(freeCashFlow),
      presentValue: Math.round(presentValue),
    });
  }

  const terminalEbitda = projection[projection.length - 1]?.ebitda ?? 0;
  const terminalValue = terminalEbitda * inputs.terminalEvEbitdaMultiple;
  const terminalPresentValue =
    terminalValue / Math.pow(1 + inputs.discountRate, inputs.projectionYears);

  const enterpriseValue =
    projection.reduce((s, p) => s + p.presentValue, 0) + terminalPresentValue;

  // Comparable franchise multiples: 6x (low), 8x (mid), 12x (high) on year-1 EBITDA.
  const yearOneEbitda = yearOneRevenue * inputs.ebitdaMargin;
  const comparableValueRange = {
    low: Math.round(yearOneEbitda * 6),
    mid: Math.round(yearOneEbitda * 8),
    high: Math.round(yearOneEbitda * 12),
  };

  return {
    inputs,
    yearOneRevenue: Math.round(yearOneRevenue),
    yearOneEbitda: Math.round(yearOneEbitda),
    projection,
    terminalValue: Math.round(terminalValue),
    terminalPresentValue: Math.round(terminalPresentValue),
    enterpriseValue: Math.round(enterpriseValue),
    comparableValueRange,
    evToYearOneEbitda:
      yearOneEbitda > 0 ? Math.round((enterpriseValue / yearOneEbitda) * 10) / 10 : 0,
  };
}
