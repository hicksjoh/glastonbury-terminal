// Macro Signal Engine — pure TypeScript, zero external dependencies
// Classifies the macro environment into regimes and produces asset allocation + Fed predictions

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MacroRegimeType =
  | 'expansion'
  | 'late_cycle'
  | 'slowdown'
  | 'recession'
  | 'recovery'
  | 'reflation';

export interface MacroIndicators {
  yield10Y: number;
  yield2Y: number;
  fedFunds: number;
  vix: number;
  dxy: number;
  copperGoldRatio: number;
  creditSpread: number;
  unemploymentRate: number;
  ismManufacturing: number;
  cpi: number;
  gdpGrowth: number;
}

export interface MacroRegime {
  regime: MacroRegimeType;
  confidence: number;
  score: number;
  factorBreakdown: Record<string, { score: number; signal: string }>;
  allocation: AssetAllocation;
  fedPrediction: FedPrediction;
}

export interface AssetAllocation {
  equities: number;
  bonds: number;
  commodities: number;
  cash: number;
  alternatives: number;
}

export interface FedPrediction {
  prediction: 'hike' | 'hold' | 'cut';
  confidence: number;
  impliedRate: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation score: maps value from [lo, hi] → [-2, +2] */
function linearScore(value: number, bearish: number, bullish: number): number {
  if (bearish === bullish) return 0;
  const raw = ((value - bearish) / (bullish - bearish)) * 4 - 2;
  return clamp(raw, -2, 2);
}

// ---------------------------------------------------------------------------
// Factor scoring (each returns -2 … +2)
// ---------------------------------------------------------------------------

function scoreYieldCurve(y10: number, y2: number): { score: number; signal: string } {
  const spread = y10 - y2;
  // Deeply inverted → strong recession signal (-2), steep positive → expansion (+2)
  let score: number;
  if (spread < -0.5) score = -2;
  else if (spread < 0) score = linearScore(spread, -0.5, 0);
  else if (spread < 0.5) score = linearScore(spread, 0, 0.5) * 0.5; // mild positive
  else if (spread < 1.5) score = linearScore(spread, 0.5, 1.5) + 0.5;
  else score = 2;

  let signal: string;
  if (spread < -0.25) signal = 'inverted — recession warning';
  else if (spread < 0.1) signal = 'flat — late cycle';
  else if (spread < 1.0) signal = 'normal — moderate expansion';
  else signal = 'steep — strong expansion';

  return { score: clamp(score, -2, 2), signal };
}

function scoreCreditSpread(spread: number): { score: number; signal: string } {
  // Tight spreads (~1%) = bullish, wide (~5%+) = stress
  const score = linearScore(spread, 5, 1);
  let signal: string;
  if (spread > 4) signal = 'crisis-level widening';
  else if (spread > 2.5) signal = 'elevated stress';
  else if (spread > 1.5) signal = 'normal';
  else signal = 'tight — risk-on';

  return { score, signal };
}

function scoreVix(vix: number): { score: number; signal: string } {
  // Low VIX = bullish, high VIX = fear
  const score = linearScore(vix, 35, 12);
  let signal: string;
  if (vix > 30) signal = 'panic';
  else if (vix > 20) signal = 'elevated fear';
  else if (vix > 14) signal = 'normal';
  else signal = 'complacency';

  return { score, signal };
}

function scoreDxy(dxy: number): { score: number; signal: string } {
  // Very strong dollar hurts risk assets; moderate weakness is bullish for global growth
  const score = linearScore(dxy, 110, 95);
  let signal: string;
  if (dxy > 108) signal = 'strong dollar — headwind for risk';
  else if (dxy > 100) signal = 'firm dollar';
  else if (dxy > 95) signal = 'neutral';
  else signal = 'weak dollar — tailwind for commodities/EM';

  return { score, signal };
}

function scoreCopperGold(ratio: number): { score: number; signal: string } {
  // Higher ratio = industrial strength; lower = safe-haven demand
  // Typical range ~0.15 – 0.30
  const score = linearScore(ratio, 0.12, 0.28);
  let signal: string;
  if (ratio > 0.25) signal = 'industrial strength';
  else if (ratio > 0.18) signal = 'balanced';
  else signal = 'safe-haven dominance';

  return { score, signal };
}

function scoreFedFunds(rate: number): { score: number; signal: string } {
  // Very high rates = restrictive = bearish; low rates = accommodative = bullish
  const score = linearScore(rate, 6, 1);
  let signal: string;
  if (rate > 5) signal = 'highly restrictive';
  else if (rate > 3) signal = 'restrictive';
  else if (rate > 1.5) signal = 'neutral';
  else signal = 'accommodative';

  return { score, signal };
}

function scoreUnemployment(rate: number): { score: number; signal: string } {
  // Low unemployment = strong economy; high = weakness
  const score = linearScore(rate, 7, 3.5);
  let signal: string;
  if (rate > 6) signal = 'recessionary labor market';
  else if (rate > 5) signal = 'weakening';
  else if (rate > 4) signal = 'healthy';
  else signal = 'tight labor market';

  return { score, signal };
}

function scoreIsm(ism: number): { score: number; signal: string } {
  // >50 = expansion, <50 = contraction
  const score = linearScore(ism, 42, 58);
  let signal: string;
  if (ism > 55) signal = 'strong expansion';
  else if (ism > 50) signal = 'expanding';
  else if (ism > 45) signal = 'contracting';
  else signal = 'deep contraction';

  return { score, signal };
}

// ---------------------------------------------------------------------------
// Regime mapping
// ---------------------------------------------------------------------------

function mapScoreToRegime(compositeScore: number, indicators: MacroIndicators): MacroRegimeType {
  const yieldSpread = indicators.yield10Y - indicators.yield2Y;

  // Strong positive score → expansion or recovery
  if (compositeScore >= 1.0) {
    // If coming from low GDP or high unemployment, it is recovery
    if (indicators.gdpGrowth < 1.5 || indicators.unemploymentRate > 5.5) {
      return 'recovery';
    }
    return 'expansion';
  }

  // Mildly positive → could be late cycle or reflation
  if (compositeScore >= 0) {
    if (indicators.cpi > 3.5 && indicators.gdpGrowth > 1.0) {
      return 'reflation';
    }
    if (yieldSpread < 0.3 && indicators.fedFunds > 3.5) {
      return 'late_cycle';
    }
    return 'expansion';
  }

  // Mildly negative → slowdown
  if (compositeScore >= -1.0) {
    if (yieldSpread < -0.2) {
      return 'recession';
    }
    return 'slowdown';
  }

  // Strongly negative → recession
  return 'recession';
}

// ---------------------------------------------------------------------------
// Confidence calculation
// ---------------------------------------------------------------------------

function computeConfidence(
  factorBreakdown: Record<string, { score: number; signal: string }>,
  compositeScore: number,
): number {
  const scores = Object.values(factorBreakdown).map((f) => f.score);
  const n = scores.length;
  if (n === 0) return 0;

  // Confidence is higher when factors agree (low variance) and composite is extreme
  const mean = compositeScore;
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Max confidence when stdDev ≈ 0 and |mean| ≈ 2
  const agreementFactor = clamp(1 - stdDev / 2, 0, 1);
  const magnitudeFactor = clamp(Math.abs(mean) / 2, 0, 1);

  const confidence = 0.6 * agreementFactor + 0.4 * magnitudeFactor;
  return Math.round(confidence * 100) / 100;
}

// ---------------------------------------------------------------------------
// Fed Watch Model (Taylor Rule)
// ---------------------------------------------------------------------------

export function fedWatchModel(
  fedFundsRate: number,
  cpi: number,
  unemployment: number,
): FedPrediction {
  const NEUTRAL_RATE = 2.5;
  const INFLATION_TARGET = 2.0;
  // Output gap proxy: lower unemployment → positive gap
  // NAIRU ≈ 4.5%; each 1% below → +1% output gap
  const outputGapProxy = (4.5 - unemployment) * 1.0;

  const taylorTarget =
    NEUTRAL_RATE +
    0.5 * (cpi - INFLATION_TARGET) +
    0.5 * outputGapProxy;

  const impliedRate = Math.round(taylorTarget * 100) / 100;
  const gap = taylorTarget - fedFundsRate;

  let prediction: 'hike' | 'hold' | 'cut';
  if (gap > 0.25) {
    prediction = 'hike';
  } else if (gap < -0.25) {
    prediction = 'cut';
  } else {
    prediction = 'hold';
  }

  // Confidence scales with distance from the threshold
  const absGap = Math.abs(gap);
  const confidence =
    absGap <= 0.25
      ? clamp(0.3 + 0.2 * (1 - absGap / 0.25), 0, 1) // hold zone: moderate confidence
      : clamp(0.5 + Math.min(absGap - 0.25, 1.5) / 3, 0, 1); // directional: rises with distance

  return {
    prediction,
    confidence: Math.round(confidence * 100) / 100,
    impliedRate,
  };
}

// ---------------------------------------------------------------------------
// Regime-based asset allocation
// ---------------------------------------------------------------------------

export function getRegimeAllocation(regime: MacroRegimeType): AssetAllocation {
  switch (regime) {
    case 'expansion':
      return { equities: 0.55, bonds: 0.15, commodities: 0.10, cash: 0.05, alternatives: 0.15 };
    case 'late_cycle':
      return { equities: 0.30, bonds: 0.20, commodities: 0.10, cash: 0.15, alternatives: 0.25 };
    case 'slowdown':
      return { equities: 0.20, bonds: 0.35, commodities: 0.05, cash: 0.25, alternatives: 0.15 };
    case 'recession':
      return { equities: 0.10, bonds: 0.40, commodities: 0.15, cash: 0.25, alternatives: 0.10 };
    case 'recovery':
      return { equities: 0.50, bonds: 0.15, commodities: 0.20, cash: 0.05, alternatives: 0.10 };
    case 'reflation':
      return { equities: 0.25, bonds: 0.10, commodities: 0.35, cash: 0.05, alternatives: 0.25 };
  }
}

// ---------------------------------------------------------------------------
// Main assessment
// ---------------------------------------------------------------------------

export function assessMacroRegime(indicators: MacroIndicators): MacroRegime {
  const factorBreakdown: Record<string, { score: number; signal: string }> = {
    yieldCurve: scoreYieldCurve(indicators.yield10Y, indicators.yield2Y),
    creditSpread: scoreCreditSpread(indicators.creditSpread),
    vix: scoreVix(indicators.vix),
    dollarStrength: scoreDxy(indicators.dxy),
    copperGold: scoreCopperGold(indicators.copperGoldRatio),
    fedFunds: scoreFedFunds(indicators.fedFunds),
    unemployment: scoreUnemployment(indicators.unemploymentRate),
    ismManufacturing: scoreIsm(indicators.ismManufacturing),
  };

  const scores = Object.values(factorBreakdown).map((f) => f.score);
  const compositeScore =
    Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;

  const regime = mapScoreToRegime(compositeScore, indicators);
  const confidence = computeConfidence(factorBreakdown, compositeScore);
  const allocation = getRegimeAllocation(regime);
  const fedPrediction = fedWatchModel(indicators.fedFunds, indicators.cpi, indicators.unemploymentRate);

  return {
    regime,
    confidence,
    score: compositeScore,
    factorBreakdown,
    allocation,
    fedPrediction,
  };
}
