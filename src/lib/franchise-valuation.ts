/**
 * Franchise Valuation Engine
 * DCF + comparable analysis for CR3 territories
 */

export interface TerritoryValuation {
  territoryId: string;
  name: string;
  dcfValue: number;
  comparableValue: number;
  networkPremium: number;
  totalValue: number;
  method: 'dcf' | 'comparable' | 'blended';
}

export interface ValuationInput {
  territoryId: string;
  name: string;
  annualRoyalties: number;
  growthRate: number; // Annual growth rate (e.g., 0.05 = 5%)
  yearsToProject: number;
  adjacentTerritories: number; // Count of adjacent owned territories
  strategy: 'operate' | 'sell' | 'hybrid';
  status: string;
}

const DISCOUNT_RATE = 0.13; // Franchise industry typical: 12-15%
const TERMINAL_GROWTH_RATE = 0.025; // Long-term growth rate
const EBITDA_MULTIPLE_LOW = 3.0; // Service franchise resale range
const EBITDA_MULTIPLE_HIGH = 5.0;
const NETWORK_PREMIUM_PER_ADJACENT = 0.05; // +5% per adjacent territory

/**
 * DCF valuation — project royalty streams and discount back
 */
export function dcfValuation(
  annualRoyalties: number,
  growthRate: number,
  yearsToProject: number = 10,
  discountRate: number = DISCOUNT_RATE,
): number {
  let npv = 0;

  for (let year = 1; year <= yearsToProject; year++) {
    const cashFlow = annualRoyalties * Math.pow(1 + growthRate, year);
    npv += cashFlow / Math.pow(1 + discountRate, year);
  }

  // Terminal value (Gordon Growth Model)
  const terminalCashFlow = annualRoyalties * Math.pow(1 + growthRate, yearsToProject + 1);
  const terminalValue = terminalCashFlow / (discountRate - TERMINAL_GROWTH_RATE);
  npv += terminalValue / Math.pow(1 + discountRate, yearsToProject);

  return npv;
}

/**
 * Comparable analysis using EBITDA multiples
 */
export function comparableValuation(annualEBITDA: number): { low: number; mid: number; high: number } {
  return {
    low: annualEBITDA * EBITDA_MULTIPLE_LOW,
    mid: annualEBITDA * (EBITDA_MULTIPLE_LOW + EBITDA_MULTIPLE_HIGH) / 2,
    high: annualEBITDA * EBITDA_MULTIPLE_HIGH,
  };
}

/**
 * Network premium: +5-20% for territories adjacent to other owned territories
 */
export function networkPremium(baseValue: number, adjacentCount: number): number {
  const premium = Math.min(adjacentCount * NETWORK_PREMIUM_PER_ADJACENT, 0.20);
  return baseValue * premium;
}

/**
 * Full territory valuation
 */
export function valuateTerritory(input: ValuationInput): TerritoryValuation {
  const royalties = input.annualRoyalties;
  const ebitda = royalties * 0.6; // Assume 60% EBITDA margin

  const dcf = dcfValuation(royalties, input.growthRate, input.yearsToProject);
  const comp = comparableValuation(ebitda);
  const netPremium = networkPremium(dcf, input.adjacentTerritories);

  // Blend: 60% DCF, 40% comparable
  const blendedValue = dcf * 0.6 + comp.mid * 0.4 + netPremium;

  // Adjust for status
  let statusMultiplier = 1.0;
  if (input.status === 'developing') statusMultiplier = 0.6;
  if (input.status === 'listed') statusMultiplier = 0.9;

  const totalValue = blendedValue * statusMultiplier;

  return {
    territoryId: input.territoryId,
    name: input.name,
    dcfValue: dcf,
    comparableValue: comp.mid,
    networkPremium: netPremium,
    totalValue,
    method: 'blended',
  };
}

/**
 * Total franchise portfolio valuation
 */
export function valuatePortfolio(territories: ValuationInput[]): {
  territories: TerritoryValuation[];
  totalValue: number;
  avgValue: number;
} {
  const valuations = territories.map(valuateTerritory);
  const totalValue = valuations.reduce((sum, v) => sum + v.totalValue, 0);

  return {
    territories: valuations,
    totalValue,
    avgValue: valuations.length > 0 ? totalValue / valuations.length : 0,
  };
}
