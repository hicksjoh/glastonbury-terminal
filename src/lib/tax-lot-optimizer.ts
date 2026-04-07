// ============================================================
// TAX LOT OPTIMIZER
// Choose WHICH shares to sell for optimal tax outcomes
// Methods: FIFO, LIFO, HIFO, Specific ID
// ============================================================

import {
  type FilingStatus,
  type TaxLotMethod,
  type GainType,
  ACTIVE_TAX_YEAR,
  type TaxYearData,
  calculateCapitalGainsTax,
  classifyHoldingPeriod,
  TAX_DISCLAIMER,
} from './tax-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaxLot {
  id: string;
  ticker: string;
  buyDate: Date;
  quantity: number;
  costBasis: number; // per share
  currentPrice: number;
}

export interface SelectedLot {
  lot: TaxLot;
  quantityToSell: number;
  gainLoss: number;
  gainLossPerShare: number;
  gainType: GainType;
  daysHeld: number;
  taxEstimate: number;
}

export interface LotSelectionResult {
  method: TaxLotMethod;
  selectedLots: SelectedLot[];
  totalGainLoss: number;
  totalTaxEstimate: number;
  shortTermGains: number;
  longTermGains: number;
  recommendation: string;
  disclaimer: string;
}

export interface LotComparisonResult {
  methods: Record<TaxLotMethod, LotSelectionResult>;
  bestMethod: TaxLotMethod;
  worstMethod: TaxLotMethod;
  maxSavings: number;
  explanation: string;
  disclaimer: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyLot(lot: TaxLot, sellDate: Date, taxYear: TaxYearData): { gainType: GainType; daysHeld: number } {
  const result = classifyHoldingPeriod(lot.buyDate, sellDate, taxYear);
  return { gainType: result.type, daysHeld: result.daysHeld };
}

/**
 * Estimate tax on a gain/loss given its type and the user's income context.
 * Short-term gains taxed as ordinary income (use marginal rate).
 * Long-term gains taxed at capital gains rates (0/15/20%).
 */
function estimateTaxOnGain(
  gainLoss: number,
  gainType: GainType,
  marginalRate: number,
  ordinaryIncome: number,
  filingStatus: FilingStatus,
  taxYear: TaxYearData,
): number {
  if (gainLoss <= 0) {
    // Losses produce a tax benefit (negative tax = savings)
    // Short-term losses offset gains at the marginal rate
    // Long-term losses offset at the cap gains rate, but simplify to marginal for savings estimate
    return Math.round(gainLoss * marginalRate * 100) / 100;
  }

  if (gainType === 'short_term') {
    // Short-term gains taxed at ordinary income rates
    return Math.round(gainLoss * marginalRate * 100) / 100;
  }

  // Long-term gains — use the proper capital gains brackets
  const capGainsResult = calculateCapitalGainsTax(gainLoss, ordinaryIncome, filingStatus, taxYear);
  return capGainsResult.tax;
}

// ─── Lot Sorting Strategies ─────────────────────────────────────────────────

function sortFIFO(lots: TaxLot[]): TaxLot[] {
  return [...lots].sort((a, b) => new Date(a.buyDate).getTime() - new Date(b.buyDate).getTime());
}

function sortLIFO(lots: TaxLot[]): TaxLot[] {
  return [...lots].sort((a, b) => new Date(b.buyDate).getTime() - new Date(a.buyDate).getTime());
}

function sortHIFO(lots: TaxLot[]): TaxLot[] {
  return [...lots].sort((a, b) => b.costBasis - a.costBasis);
}

function sortSpecific(lots: TaxLot[], specificLotIds: string[]): TaxLot[] {
  const idSet = new Set(specificLotIds);
  const selected = lots.filter(l => idSet.has(l.id));
  // Maintain the order the user specified
  return specificLotIds.map(id => selected.find(l => l.id === id)).filter((l): l is TaxLot => l !== undefined);
}

// ─── Core: Select Lots ──────────────────────────────────────────────────────

/**
 * Select which lots to sell based on a method.
 * Returns the lots chosen, their individual tax impacts, and totals.
 */
export function selectLots(
  lots: TaxLot[],
  quantityToSell: number,
  method: TaxLotMethod,
  options: {
    marginalRate?: number;
    ordinaryIncome?: number;
    filingStatus?: FilingStatus;
    sellDate?: Date;
    specificLotIds?: string[];
    taxYear?: TaxYearData;
  } = {},
): LotSelectionResult {
  const {
    marginalRate = 0.24,
    ordinaryIncome = 100000,
    filingStatus = 'single',
    sellDate = new Date(),
    specificLotIds = [],
    taxYear = ACTIVE_TAX_YEAR,
  } = options;

  // Filter to lots with available shares for this ticker
  const availableLots = lots.filter(l => l.quantity > 0);

  // Sort based on method
  let sortedLots: TaxLot[];
  switch (method) {
    case 'fifo':
      sortedLots = sortFIFO(availableLots);
      break;
    case 'lifo':
      sortedLots = sortLIFO(availableLots);
      break;
    case 'hifo':
      sortedLots = sortHIFO(availableLots);
      break;
    case 'specific':
      sortedLots = sortSpecific(availableLots, specificLotIds);
      break;
    default:
      sortedLots = sortFIFO(availableLots);
  }

  // Select lots until we've filled the requested quantity
  const selectedLots: SelectedLot[] = [];
  let remaining = quantityToSell;
  let totalGainLoss = 0;
  let totalTaxEstimate = 0;
  let shortTermGains = 0;
  let longTermGains = 0;

  for (const lot of sortedLots) {
    if (remaining <= 0) break;

    const qtyFromLot = Math.min(remaining, lot.quantity);
    const { gainType, daysHeld } = classifyLot(lot, sellDate, taxYear);
    const gainLossPerShare = lot.currentPrice - lot.costBasis;
    const gainLoss = Math.round(gainLossPerShare * qtyFromLot * 100) / 100;
    const taxEstimate = estimateTaxOnGain(gainLoss, gainType, marginalRate, ordinaryIncome, filingStatus, taxYear);

    if (gainType === 'short_term') {
      shortTermGains += gainLoss;
    } else {
      longTermGains += gainLoss;
    }

    selectedLots.push({
      lot,
      quantityToSell: qtyFromLot,
      gainLoss,
      gainLossPerShare,
      gainType,
      daysHeld,
      taxEstimate,
    });

    totalGainLoss += gainLoss;
    totalTaxEstimate += taxEstimate;
    remaining -= qtyFromLot;
  }

  totalGainLoss = Math.round(totalGainLoss * 100) / 100;
  totalTaxEstimate = Math.round(totalTaxEstimate * 100) / 100;
  shortTermGains = Math.round(shortTermGains * 100) / 100;
  longTermGains = Math.round(longTermGains * 100) / 100;

  // Build recommendation text
  const methodNames: Record<TaxLotMethod, string> = {
    fifo: 'First In, First Out (FIFO)',
    lifo: 'Last In, First Out (LIFO)',
    hifo: 'Highest In, First Out (HIFO)',
    specific: 'Specific Lot Selection',
  };

  const recommendation = totalGainLoss >= 0
    ? `${methodNames[method]} results in a $${Math.abs(totalGainLoss).toLocaleString()} gain with an estimated $${Math.abs(totalTaxEstimate).toLocaleString()} in taxes.`
    : `${methodNames[method]} results in a $${Math.abs(totalGainLoss).toLocaleString()} loss, providing an estimated $${Math.abs(totalTaxEstimate).toLocaleString()} in tax savings.`;

  return {
    method,
    selectedLots,
    totalGainLoss,
    totalTaxEstimate,
    shortTermGains,
    longTermGains,
    recommendation,
    disclaimer: TAX_DISCLAIMER,
  };
}

// ─── Core: Compare All Methods ──────────────────────────────────────────────

/**
 * Run all 4 lot selection methods and compare tax outcomes.
 * Returns the optimal choice with dollar savings vs worst method.
 */
export function compareLotMethods(
  lots: TaxLot[],
  quantityToSell: number,
  options: {
    marginalRate?: number;
    ordinaryIncome?: number;
    filingStatus?: FilingStatus;
    sellDate?: Date;
    taxYear?: TaxYearData;
  } = {},
): LotComparisonResult {
  const methodKeys: TaxLotMethod[] = ['fifo', 'lifo', 'hifo'];
  const methods: Partial<Record<TaxLotMethod, LotSelectionResult>> = {};

  for (const method of methodKeys) {
    methods[method] = selectLots(lots, quantityToSell, method, options);
  }

  // Also run "specific" with all lots (equivalent to FIFO, placeholder)
  // Users would pass actual specificLotIds in practice
  methods.specific = selectLots(lots, quantityToSell, 'fifo', options);
  methods.specific = { ...methods.specific, method: 'specific' };

  const fullMethods = methods as Record<TaxLotMethod, LotSelectionResult>;

  // Find best and worst by tax estimate (lowest tax = best)
  let bestMethod: TaxLotMethod = 'fifo';
  let worstMethod: TaxLotMethod = 'fifo';
  let lowestTax = Infinity;
  let highestTax = -Infinity;

  for (const [method, result] of Object.entries(fullMethods)) {
    if (result.totalTaxEstimate < lowestTax) {
      lowestTax = result.totalTaxEstimate;
      bestMethod = method as TaxLotMethod;
    }
    if (result.totalTaxEstimate > highestTax) {
      highestTax = result.totalTaxEstimate;
      worstMethod = method as TaxLotMethod;
    }
  }

  const maxSavings = Math.round((highestTax - lowestTax) * 100) / 100;

  const methodLabels: Record<TaxLotMethod, string> = {
    fifo: 'FIFO',
    lifo: 'LIFO',
    hifo: 'HIFO',
    specific: 'Specific',
  };

  let explanation: string;
  if (maxSavings <= 0) {
    explanation = 'All methods produce the same tax outcome for this sale.';
  } else {
    const bestLabel = methodLabels[bestMethod];
    const worstLabel = methodLabels[worstMethod];
    const bestResult = fullMethods[bestMethod];

    if (bestResult.totalGainLoss < 0) {
      explanation = `${bestLabel} maximizes your tax-loss benefit, saving you $${maxSavings.toLocaleString()} more than ${worstLabel}. It selects shares with the highest losses first.`;
    } else {
      explanation = `Selling your ${bestLabel === 'HIFO' ? 'highest-cost' : bestLabel === 'LIFO' ? 'newest' : 'oldest'} shares (${bestLabel}) saves you $${maxSavings.toLocaleString()} in taxes compared to ${worstLabel}.`;
    }
  }

  return {
    methods: fullMethods,
    bestMethod,
    worstMethod,
    maxSavings,
    explanation,
    disclaimer: TAX_DISCLAIMER,
  };
}

// ─── Utility: Available Quantity Check ──────────────────────────────────────

/**
 * Calculate total available shares across all lots for a ticker.
 */
export function getAvailableQuantity(lots: TaxLot[], ticker: string): number {
  return lots
    .filter(l => l.ticker.toUpperCase() === ticker.toUpperCase() && l.quantity > 0)
    .reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Format a LotSelectionResult into human-readable summary lines.
 */
export function formatLotSelection(result: LotSelectionResult): string[] {
  const lines: string[] = [];
  const methodNames: Record<TaxLotMethod, string> = {
    fifo: 'FIFO (oldest first)',
    lifo: 'LIFO (newest first)',
    hifo: 'HIFO (highest cost first)',
    specific: 'Specific lots',
  };

  lines.push(`Method: ${methodNames[result.method]}`);
  lines.push(`Total Gain/Loss: ${result.totalGainLoss >= 0 ? '+' : ''}$${result.totalGainLoss.toLocaleString()}`);
  lines.push(`Tax Estimate: ${result.totalTaxEstimate >= 0 ? '' : '-'}$${Math.abs(result.totalTaxEstimate).toLocaleString()}`);

  if (result.shortTermGains !== 0) {
    lines.push(`  Short-Term: ${result.shortTermGains >= 0 ? '+' : ''}$${result.shortTermGains.toLocaleString()}`);
  }
  if (result.longTermGains !== 0) {
    lines.push(`  Long-Term: ${result.longTermGains >= 0 ? '+' : ''}$${result.longTermGains.toLocaleString()}`);
  }

  for (const sel of result.selectedLots) {
    const sign = sel.gainLoss >= 0 ? '+' : '';
    lines.push(
      `  Lot ${sel.lot.id}: ${sel.quantityToSell} shares @ $${sel.lot.costBasis.toFixed(2)} → ${sign}$${sel.gainLoss.toLocaleString()} (${sel.gainType === 'long_term' ? 'LT' : 'ST'}, ${sel.daysHeld}d)`
    );
  }

  return lines;
}
