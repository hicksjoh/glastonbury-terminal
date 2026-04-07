// ============================================================
// TAX-LOSS HARVESTING ENGINE
// Proactively finds positions to harvest losses from
// and suggests non-substantially-identical replacements
// ============================================================

import {
  type FilingStatus,
  type GainType,
  ACTIVE_TAX_YEAR,
  type TaxYearData,
  classifyHoldingPeriod,
  TAX_DISCLAIMER,
} from './tax-engine';
import type { TradeRecord } from './wash-sale-detector';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HarvestPosition {
  symbol: string;
  qty: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  currentPrice: number;
  side: 'long' | 'short';
  avgEntryPrice?: number;
  buyDate?: string; // ISO date, if available
}

export interface ReplacementSuggestion {
  ticker: string;
  name: string;
  correlation: number;
  reason: string;
}

export interface HarvestCandidate {
  ticker: string;
  currentPrice: number;
  costBasis: number;
  quantity: number;
  unrealizedLoss: number;
  unrealizedLossPct: number;
  holdingPeriod: GainType;
  daysHeld: number;
  taxSavings: number;
  replacements: ReplacementSuggestion[];
  washSaleRisk: boolean;
  washSaleNote: string;
}

export interface HarvestSummary {
  candidates: HarvestCandidate[];
  totalUnrealizedLosses: number;
  totalPotentialSavings: number;
  ytdRealizedGains: number;
  netTaxPosition: string;
  recommendation: string;
  disclaimer: string;
}

// ─── Replacement Suggestion Map ─────────────────────────────────────────────
// Non-substantially-identical alternatives to avoid triggering wash sales.
// Grouped by: individual stocks → sector ETF, sector ETFs → different provider,
// bonds → different duration/provider, international → different index.

const REPLACEMENT_MAP: Record<string, ReplacementSuggestion[]> = {
  // ── Mega-Cap Tech ────────────────────────────────
  AAPL: [
    { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.85, reason: 'Same sector ETF — tech exposure without single-stock risk' },
    { ticker: 'VGT', name: 'Vanguard Info Tech ETF', correlation: 0.87, reason: 'Broad tech index fund with similar holdings' },
    { ticker: 'MSFT', name: 'Microsoft Corp', correlation: 0.72, reason: 'Competing mega-cap tech with similar characteristics' },
  ],
  MSFT: [
    { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.88, reason: 'Same sector ETF — broad tech exposure' },
    { ticker: 'VGT', name: 'Vanguard Info Tech ETF', correlation: 0.89, reason: 'Broad tech index with MSFT-like weighting' },
    { ticker: 'CRM', name: 'Salesforce Inc', correlation: 0.65, reason: 'Enterprise software peer' },
  ],
  NVDA: [
    { ticker: 'SMH', name: 'VanEck Semiconductor ETF', correlation: 0.90, reason: 'Semiconductor sector ETF — AI/chip exposure' },
    { ticker: 'SOXX', name: 'iShares Semiconductor ETF', correlation: 0.88, reason: 'Alternative semiconductor index' },
    { ticker: 'AMD', name: 'Advanced Micro Devices', correlation: 0.78, reason: 'Competing GPU/AI chip maker' },
  ],
  AMD: [
    { ticker: 'SMH', name: 'VanEck Semiconductor ETF', correlation: 0.85, reason: 'Semiconductor sector ETF' },
    { ticker: 'SOXX', name: 'iShares Semiconductor ETF', correlation: 0.83, reason: 'Alternative semiconductor index' },
    { ticker: 'NVDA', name: 'NVIDIA Corp', correlation: 0.78, reason: 'Competing chip maker — not substantially identical' },
  ],
  GOOGL: [
    { ticker: 'XLC', name: 'Communication Services SPDR', correlation: 0.82, reason: 'Communication services sector ETF' },
    { ticker: 'META', name: 'Meta Platforms', correlation: 0.68, reason: 'Competing digital advertising platform' },
    { ticker: 'VGT', name: 'Vanguard Info Tech ETF', correlation: 0.80, reason: 'Broad tech with Alphabet weight' },
  ],
  GOOG: [
    { ticker: 'XLC', name: 'Communication Services SPDR', correlation: 0.82, reason: 'Communication services sector' },
    { ticker: 'META', name: 'Meta Platforms', correlation: 0.68, reason: 'Competing ad tech giant' },
  ],
  META: [
    { ticker: 'XLC', name: 'Communication Services SPDR', correlation: 0.80, reason: 'Communication services sector ETF' },
    { ticker: 'GOOGL', name: 'Alphabet Inc', correlation: 0.68, reason: 'Competing digital advertising platform' },
    { ticker: 'SNAP', name: 'Snap Inc', correlation: 0.55, reason: 'Social media peer (higher risk)' },
  ],
  AMZN: [
    { ticker: 'XLY', name: 'Consumer Discretionary SPDR', correlation: 0.78, reason: 'Consumer discretionary sector ETF' },
    { ticker: 'SHOP', name: 'Shopify Inc', correlation: 0.60, reason: 'E-commerce platform peer' },
    { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.82, reason: 'Broad tech with cloud exposure' },
  ],
  TSLA: [
    { ticker: 'DRIV', name: 'Global X Autonomous & EV ETF', correlation: 0.72, reason: 'EV/autonomous vehicle sector ETF' },
    { ticker: 'XLY', name: 'Consumer Discretionary SPDR', correlation: 0.60, reason: 'Consumer discretionary sector' },
    { ticker: 'RIVN', name: 'Rivian Automotive', correlation: 0.55, reason: 'Competing EV manufacturer' },
  ],

  // ── Financials ───────────────────────────────────
  JPM: [
    { ticker: 'XLF', name: 'Financial Select Sector SPDR', correlation: 0.88, reason: 'Financial sector ETF' },
    { ticker: 'VFH', name: 'Vanguard Financials ETF', correlation: 0.87, reason: 'Broad financials exposure' },
    { ticker: 'BAC', name: 'Bank of America', correlation: 0.82, reason: 'Peer mega-cap bank' },
  ],
  BAC: [
    { ticker: 'XLF', name: 'Financial Select Sector SPDR', correlation: 0.85, reason: 'Financial sector ETF' },
    { ticker: 'JPM', name: 'JPMorgan Chase', correlation: 0.82, reason: 'Peer mega-cap bank' },
  ],

  // ── Healthcare ───────────────────────────────────
  JNJ: [
    { ticker: 'XLV', name: 'Health Care Select Sector SPDR', correlation: 0.78, reason: 'Healthcare sector ETF' },
    { ticker: 'VHT', name: 'Vanguard Health Care ETF', correlation: 0.80, reason: 'Broad healthcare exposure' },
    { ticker: 'PFE', name: 'Pfizer Inc', correlation: 0.55, reason: 'Competing pharma company' },
  ],

  // ── Energy ───────────────────────────────────────
  XOM: [
    { ticker: 'XLE', name: 'Energy Select Sector SPDR', correlation: 0.90, reason: 'Energy sector ETF' },
    { ticker: 'VDE', name: 'Vanguard Energy ETF', correlation: 0.89, reason: 'Broad energy sector fund' },
    { ticker: 'CVX', name: 'Chevron Corp', correlation: 0.85, reason: 'Peer integrated oil major' },
  ],
  CVX: [
    { ticker: 'XLE', name: 'Energy Select Sector SPDR', correlation: 0.88, reason: 'Energy sector ETF' },
    { ticker: 'XOM', name: 'Exxon Mobil', correlation: 0.85, reason: 'Peer integrated oil major' },
  ],

  // ── Broad Market ETFs ────────────────────────────
  SPY: [
    { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', correlation: 0.99, reason: 'Same index, different provider — NOT substantially identical per most tax advisors' },
    { ticker: 'IVV', name: 'iShares Core S&P 500', correlation: 0.99, reason: 'Same index, BlackRock provider' },
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', correlation: 0.98, reason: 'Broader US market exposure' },
  ],
  VOO: [
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF', correlation: 0.99, reason: 'Same index, different provider' },
    { ticker: 'IVV', name: 'iShares Core S&P 500', correlation: 0.99, reason: 'Same index, BlackRock' },
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', correlation: 0.98, reason: 'Broader market, same provider' },
  ],
  QQQ: [
    { ticker: 'VGT', name: 'Vanguard Info Tech ETF', correlation: 0.95, reason: 'Tech-heavy ETF, different index methodology' },
    { ticker: 'QQQM', name: 'Invesco NASDAQ 100 (Mini)', correlation: 0.99, reason: 'Same index, lower expense ratio' },
    { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.90, reason: 'Technology sector, different index' },
  ],
  IWM: [
    { ticker: 'VB', name: 'Vanguard Small-Cap ETF', correlation: 0.97, reason: 'Small-cap exposure, different index' },
    { ticker: 'SCHA', name: 'Schwab U.S. Small-Cap ETF', correlation: 0.96, reason: 'Small-cap, different provider & index' },
    { ticker: 'IJR', name: 'iShares Core S&P Small-Cap', correlation: 0.95, reason: 'S&P SmallCap 600 — quality filter' },
  ],
  DIA: [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', correlation: 0.95, reason: 'Broader US exposure than Dow 30' },
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF', correlation: 0.96, reason: 'Broader large-cap, different index' },
  ],

  // ── Sector ETFs → different provider ─────────────
  XLK: [
    { ticker: 'VGT', name: 'Vanguard Info Tech ETF', correlation: 0.98, reason: 'Same sector, different provider and index methodology' },
    { ticker: 'IYW', name: 'iShares U.S. Technology', correlation: 0.97, reason: 'Tech sector, BlackRock' },
  ],
  VGT: [
    { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.98, reason: 'Same sector, SPDR provider' },
    { ticker: 'IYW', name: 'iShares U.S. Technology', correlation: 0.97, reason: 'Tech sector, BlackRock' },
  ],
  XLF: [
    { ticker: 'VFH', name: 'Vanguard Financials ETF', correlation: 0.97, reason: 'Same sector, Vanguard' },
    { ticker: 'IYF', name: 'iShares U.S. Financials', correlation: 0.96, reason: 'Same sector, BlackRock' },
  ],
  XLE: [
    { ticker: 'VDE', name: 'Vanguard Energy ETF', correlation: 0.98, reason: 'Same sector, Vanguard' },
    { ticker: 'IYE', name: 'iShares U.S. Energy', correlation: 0.97, reason: 'Same sector, BlackRock' },
  ],
  XLV: [
    { ticker: 'VHT', name: 'Vanguard Health Care ETF', correlation: 0.97, reason: 'Same sector, Vanguard' },
    { ticker: 'IYH', name: 'iShares U.S. Healthcare', correlation: 0.96, reason: 'Same sector, BlackRock' },
  ],

  // ── International ────────────────────────────────
  EFA: [
    { ticker: 'IEFA', name: 'iShares Core MSCI EAFE', correlation: 0.99, reason: 'Same developed-market ex-US index, lower cost' },
    { ticker: 'VEA', name: 'Vanguard FTSE Developed Markets', correlation: 0.97, reason: 'Developed markets, different index' },
    { ticker: 'SPDW', name: 'SPDR Developed World ex-US', correlation: 0.96, reason: 'Developed markets, SPDR' },
  ],
  IEFA: [
    { ticker: 'EFA', name: 'iShares MSCI EAFE', correlation: 0.99, reason: 'Same region, different share class' },
    { ticker: 'VEA', name: 'Vanguard FTSE Developed Markets', correlation: 0.97, reason: 'Developed markets, Vanguard' },
  ],
  EEM: [
    { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets', correlation: 0.97, reason: 'Emerging markets, different index provider' },
    { ticker: 'IEMG', name: 'iShares Core MSCI Emerging Mkts', correlation: 0.98, reason: 'Emerging markets, different MSCI index' },
  ],
  VWO: [
    { ticker: 'EEM', name: 'iShares MSCI Emerging Markets', correlation: 0.97, reason: 'Same region, iShares' },
    { ticker: 'IEMG', name: 'iShares Core MSCI Emerging Mkts', correlation: 0.96, reason: 'Emerging markets, broader coverage' },
  ],

  // ── Bonds ────────────────────────────────────────
  AGG: [
    { ticker: 'BND', name: 'Vanguard Total Bond Market', correlation: 0.98, reason: 'Similar US aggregate bond exposure, Vanguard' },
    { ticker: 'SCHZ', name: 'Schwab U.S. Aggregate Bond', correlation: 0.97, reason: 'Similar exposure, Schwab' },
  ],
  BND: [
    { ticker: 'AGG', name: 'iShares Core U.S. Aggregate Bond', correlation: 0.98, reason: 'Same exposure, iShares' },
    { ticker: 'SCHZ', name: 'Schwab U.S. Aggregate Bond', correlation: 0.97, reason: 'Same exposure, Schwab' },
  ],
  TLT: [
    { ticker: 'VGLT', name: 'Vanguard Long-Term Treasury', correlation: 0.98, reason: 'Long-term treasuries, Vanguard' },
    { ticker: 'SPTL', name: 'SPDR Long Term Treasury', correlation: 0.97, reason: 'Long-term treasuries, SPDR' },
  ],
  LQD: [
    { ticker: 'VCIT', name: 'Vanguard Intermediate-Term Corp Bond', correlation: 0.95, reason: 'Investment-grade corporates, similar duration' },
    { ticker: 'IGIB', name: 'iShares 5-10 Year IG Corp Bond', correlation: 0.93, reason: 'Similar credit quality, different maturity bucket' },
  ],
};

// Sector mapping for generic fallback suggestions
const SECTOR_ETF_MAP: Record<string, ReplacementSuggestion> = {
  technology: { ticker: 'XLK', name: 'Technology Select Sector SPDR', correlation: 0.80, reason: 'Technology sector ETF — broad sector exposure' },
  healthcare: { ticker: 'XLV', name: 'Health Care Select Sector SPDR', correlation: 0.75, reason: 'Healthcare sector ETF' },
  financials: { ticker: 'XLF', name: 'Financial Select Sector SPDR', correlation: 0.80, reason: 'Financial sector ETF' },
  energy: { ticker: 'XLE', name: 'Energy Select Sector SPDR', correlation: 0.82, reason: 'Energy sector ETF' },
  'consumer discretionary': { ticker: 'XLY', name: 'Consumer Discretionary SPDR', correlation: 0.75, reason: 'Consumer discretionary sector ETF' },
  'consumer staples': { ticker: 'XLP', name: 'Consumer Staples SPDR', correlation: 0.70, reason: 'Consumer staples sector ETF' },
  industrials: { ticker: 'XLI', name: 'Industrial Select Sector SPDR', correlation: 0.78, reason: 'Industrials sector ETF' },
  materials: { ticker: 'XLB', name: 'Materials Select Sector SPDR', correlation: 0.75, reason: 'Materials sector ETF' },
  utilities: { ticker: 'XLU', name: 'Utilities Select Sector SPDR', correlation: 0.72, reason: 'Utilities sector ETF' },
  'real estate': { ticker: 'XLRE', name: 'Real Estate Select Sector SPDR', correlation: 0.70, reason: 'Real estate sector ETF' },
  communication: { ticker: 'XLC', name: 'Communication Services SPDR', correlation: 0.78, reason: 'Communication services sector ETF' },
};

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Get replacement suggestions for a given ticker.
 * Returns 2-3 non-substantially-identical alternatives.
 */
export function getReplacementSuggestions(ticker: string): ReplacementSuggestion[] {
  const upper = ticker.toUpperCase();

  // Check the detailed map first
  if (REPLACEMENT_MAP[upper]) {
    return REPLACEMENT_MAP[upper];
  }

  // Fallback: suggest a broad market ETF + a sector ETF
  return [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', correlation: 0.65, reason: 'Broad US market — diversifies away from single-stock risk' },
    SECTOR_ETF_MAP['technology'] || { ticker: 'SPY', name: 'SPDR S&P 500 ETF', correlation: 0.70, reason: 'Large-cap US equity — broad market exposure' },
  ];
}

/**
 * Check if a position has wash sale risk (bought within the last 30 days).
 */
function checkWashSaleRisk(
  ticker: string,
  trades: TradeRecord[],
): { isRisk: boolean; note: string } {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const tickerUpper = ticker.toUpperCase();

  const recentBuys = trades.filter(t =>
    t.ticker.toUpperCase() === tickerUpper &&
    t.action === 'buy' &&
    new Date(t.date) >= thirtyDaysAgo &&
    new Date(t.date) <= now,
  );

  if (recentBuys.length > 0) {
    const latestBuy = recentBuys.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const daysAgo = Math.floor((now.getTime() - new Date(latestBuy.date).getTime()) / (1000 * 60 * 60 * 24));
    const daysToWait = 31 - daysAgo;
    return {
      isRisk: true,
      note: `Bought ${latestBuy.quantity} shares ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago. Wait ${daysToWait} more day${daysToWait !== 1 ? 's' : ''} to avoid a wash sale.`,
    };
  }

  // Also check if there was a recent sell at a loss (buying back would trigger wash sale)
  const recentSells = trades.filter(t =>
    t.ticker.toUpperCase() === tickerUpper &&
    t.action === 'sell' &&
    new Date(t.date) >= thirtyDaysAgo &&
    new Date(t.date) <= now,
  );

  if (recentSells.length > 0) {
    return {
      isRisk: false,
      note: 'Recent sells exist — if you harvested this loss, wait 31 days before rebuying to avoid a wash sale.',
    };
  }

  return { isRisk: false, note: 'No wash sale risk — no recent purchases within 30 days.' };
}

/**
 * Calculate estimated tax savings from harvesting a loss.
 */
function estimateSavings(
  unrealizedLoss: number,
  gainType: GainType,
  marginalRate: number,
): number {
  // Short-term losses offset ordinary income at the marginal rate
  // Long-term losses offset at capital gains rates (use marginal as upper bound estimate)
  const rate = gainType === 'short_term' ? marginalRate : Math.min(marginalRate, 0.20);
  return Math.round(Math.abs(unrealizedLoss) * rate * 100) / 100;
}

/**
 * Calculate YTD realized gains from trade history.
 */
function calcYTDRealizedGains(trades: TradeRecord[]): number {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const sells = trades.filter(t =>
    t.action === 'sell' && new Date(t.date) >= yearStart,
  );

  let totalGains = 0;
  for (const sell of sells) {
    // Find the most recent buy before this sell to estimate basis
    const priorBuys = trades
      .filter(t =>
        t.ticker.toUpperCase() === sell.ticker.toUpperCase() &&
        t.action === 'buy' &&
        new Date(t.date) <= new Date(sell.date),
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const basis = priorBuys.length > 0 ? priorBuys[0].price : sell.price;
    const gain = (sell.price - basis) * sell.quantity;
    totalGains += gain;
  }

  return Math.round(totalGains * 100) / 100;
}

// ─── Main Scan Function ─────────────────────────────────────────────────────

/**
 * Scan portfolio for tax-loss harvesting opportunities.
 * Returns candidates sorted by potential savings (highest first).
 */
export function scanForHarvestCandidates(
  positions: HarvestPosition[],
  trades: TradeRecord[],
  options: {
    filingStatus?: FilingStatus;
    marginalRate?: number;
    minLoss?: number;
    taxYear?: TaxYearData;
  } = {},
): HarvestSummary {
  const {
    filingStatus = 'single',
    marginalRate = 0.24,
    minLoss = 100,
    taxYear = ACTIVE_TAX_YEAR,
  } = options;

  const candidates: HarvestCandidate[] = [];
  let totalUnrealizedLosses = 0;
  let totalPotentialSavings = 0;

  for (const pos of positions) {
    // Only look at long positions with unrealized losses
    if (pos.side !== 'long') continue;
    if (pos.unrealizedPL >= 0) continue;
    if (Math.abs(pos.unrealizedPL) < minLoss) continue;

    const unrealizedLoss = pos.unrealizedPL; // negative number
    const unrealizedLossPct = pos.unrealizedPLPercent;

    // Determine holding period
    let holdingPeriod: GainType = 'short_term';
    let daysHeld = 0;

    if (pos.buyDate) {
      const hpResult = classifyHoldingPeriod(pos.buyDate, new Date(), taxYear);
      holdingPeriod = hpResult.type;
      daysHeld = hpResult.daysHeld;
    } else {
      // Estimate from trade history: find the earliest buy still open
      const buys = trades
        .filter(t => t.ticker.toUpperCase() === pos.symbol.toUpperCase() && t.action === 'buy')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (buys.length > 0) {
        const hpResult = classifyHoldingPeriod(buys[0].date, new Date(), taxYear);
        holdingPeriod = hpResult.type;
        daysHeld = hpResult.daysHeld;
      }
    }

    // Check wash sale risk
    const washRisk = checkWashSaleRisk(pos.symbol, trades);

    // Estimate tax savings
    const taxSavings = estimateSavings(unrealizedLoss, holdingPeriod, marginalRate);

    // Get replacement suggestions
    const replacements = getReplacementSuggestions(pos.symbol);

    candidates.push({
      ticker: pos.symbol,
      currentPrice: pos.currentPrice,
      costBasis: pos.avgEntryPrice || (pos.costBasis / pos.qty),
      quantity: pos.qty,
      unrealizedLoss,
      unrealizedLossPct,
      holdingPeriod,
      daysHeld,
      taxSavings,
      replacements,
      washSaleRisk: washRisk.isRisk,
      washSaleNote: washRisk.note,
    });

    totalUnrealizedLosses += unrealizedLoss;
    totalPotentialSavings += taxSavings;
  }

  // Sort by potential savings (highest first)
  candidates.sort((a, b) => b.taxSavings - a.taxSavings);

  // Calculate YTD realized gains
  const ytdRealizedGains = calcYTDRealizedGains(trades);

  // Build summary
  totalUnrealizedLosses = Math.round(totalUnrealizedLosses * 100) / 100;
  totalPotentialSavings = Math.round(totalPotentialSavings * 100) / 100;

  let netTaxPosition: string;
  if (ytdRealizedGains > 0 && totalUnrealizedLosses < 0) {
    const offsetable = Math.min(ytdRealizedGains, Math.abs(totalUnrealizedLosses));
    netTaxPosition = `You have $${ytdRealizedGains.toLocaleString()} in YTD realized gains. Harvesting ${candidates.length} loss position${candidates.length !== 1 ? 's' : ''} could offset $${offsetable.toLocaleString()} of those gains.`;
  } else if (ytdRealizedGains > 0) {
    netTaxPosition = `You have $${ytdRealizedGains.toLocaleString()} in YTD realized gains with no current harvest opportunities above the minimum threshold.`;
  } else if (ytdRealizedGains < 0) {
    netTaxPosition = `You already have $${Math.abs(ytdRealizedGains).toLocaleString()} in YTD realized losses. Additional harvesting may exceed the $${ACTIVE_TAX_YEAR.lossDeductionLimit[filingStatus].toLocaleString()} annual loss deduction limit (excess carries forward).`;
  } else {
    netTaxPosition = 'No YTD realized gains or losses yet. Harvested losses can offset up to $3,000 in ordinary income.';
  }

  let recommendation: string;
  if (candidates.length === 0) {
    recommendation = 'No tax-loss harvesting opportunities found. All positions are either at a gain or below the minimum loss threshold.';
  } else if (candidates.filter(c => !c.washSaleRisk).length === 0) {
    recommendation = `Found ${candidates.length} position${candidates.length !== 1 ? 's' : ''} with losses, but all have wash sale risk. Wait for the 30-day window to close before harvesting.`;
  } else {
    const actionable = candidates.filter(c => !c.washSaleRisk);
    const topCandidate = actionable[0];
    recommendation = `Found ${actionable.length} harvestable position${actionable.length !== 1 ? 's' : ''} with $${totalPotentialSavings.toLocaleString()} in potential tax savings. Top opportunity: sell ${topCandidate.ticker} (${topCandidate.unrealizedLossPct.toFixed(1)}% loss) and replace with ${topCandidate.replacements[0]?.ticker || 'a sector ETF'} to maintain market exposure.`;
  }

  return {
    candidates,
    totalUnrealizedLosses,
    totalPotentialSavings,
    ytdRealizedGains,
    netTaxPosition,
    recommendation,
    disclaimer: TAX_DISCLAIMER,
  };
}
