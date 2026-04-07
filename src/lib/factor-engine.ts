// Factor exposure analysis — Fama-French-inspired factor model
// Computes portfolio factor loadings without external API calls
// Uses return-based style analysis

export interface FactorExposure {
  market: number;      // beta to overall market
  size: number;        // small vs large cap tilt
  value: number;       // value vs growth tilt
  momentum: number;    // trend-following exposure
  quality: number;     // profitability/stability
  volatility: number;  // low-vol vs high-vol tilt
}

export interface FactorAnalysis {
  exposures: FactorExposure;
  rSquared: number;          // how much variance is explained
  alpha: number;             // excess return after factor adjustment
  trackingError: number;     // deviation from factor model
  interpretation: string;
  riskDecomposition: {
    systematic: number;      // percentage from factor exposure
    idiosyncratic: number;   // percentage from stock-specific risk
  };
}

interface HoldingInput {
  symbol: string;
  weight: number;        // portfolio weight (0-1)
  marketCap?: number;    // in billions
  peRatio?: number;
  momentum1Y?: number;   // 1-year return
  volatility?: number;   // annualized vol
  roe?: number;          // return on equity
  beta?: number;
}

// Estimate factor exposures from portfolio holdings
export function analyzeFactorExposure(holdings: HoldingInput[]): FactorAnalysis {
  if (holdings.length === 0) {
    return emptyAnalysis('No holdings provided');
  }

  const totalWeight = holdings.reduce((sum, h) => sum + h.weight, 0);
  if (totalWeight < 0.01) return emptyAnalysis('Holdings have zero weight');

  // Normalize weights
  const normalized = holdings.map(h => ({ ...h, weight: h.weight / totalWeight }));

  // Market exposure (weighted beta)
  const market = normalized.reduce((sum, h) => sum + h.weight * (h.beta ?? 1.0), 0);

  // Size factor: small cap tilt (lower market cap = higher exposure)
  const size = normalized.reduce((sum, h) => {
    const cap = h.marketCap ?? 50; // default mid-cap
    if (cap < 2) return sum + h.weight * 0.8;      // micro cap
    if (cap < 10) return sum + h.weight * 0.4;      // small cap
    if (cap < 50) return sum + h.weight * 0.0;      // mid cap
    if (cap < 200) return sum + h.weight * -0.3;    // large cap
    return sum + h.weight * -0.6;                    // mega cap
  }, 0);

  // Value factor: low P/E = value, high P/E = growth
  const value = normalized.reduce((sum, h) => {
    const pe = h.peRatio ?? 20;
    if (pe < 0) return sum;                          // negative earnings
    if (pe < 10) return sum + h.weight * 0.8;        // deep value
    if (pe < 15) return sum + h.weight * 0.4;        // value
    if (pe < 25) return sum + h.weight * 0.0;        // blend
    if (pe < 40) return sum + h.weight * -0.4;       // growth
    return sum + h.weight * -0.8;                     // high growth
  }, 0);

  // Momentum factor: recent performance
  const momentum = normalized.reduce((sum, h) => {
    const mom = h.momentum1Y ?? 0;
    return sum + h.weight * Math.max(-1, Math.min(1, mom / 50)); // normalize to [-1, 1]
  }, 0);

  // Quality factor: profitability
  const quality = normalized.reduce((sum, h) => {
    const roe = h.roe ?? 15;
    if (roe > 30) return sum + h.weight * 0.8;
    if (roe > 20) return sum + h.weight * 0.4;
    if (roe > 10) return sum + h.weight * 0.0;
    return sum + h.weight * -0.4;
  }, 0);

  // Volatility factor
  const volatility = normalized.reduce((sum, h) => {
    const vol = h.volatility ?? 25;
    if (vol < 15) return sum + h.weight * -0.6;     // low vol
    if (vol < 25) return sum + h.weight * 0.0;      // normal vol
    if (vol < 40) return sum + h.weight * 0.4;      // high vol
    return sum + h.weight * 0.8;                     // very high vol
  }, 0);

  const exposures: FactorExposure = {
    market: round(market, 2),
    size: round(size, 2),
    value: round(value, 2),
    momentum: round(momentum, 2),
    quality: round(quality, 2),
    volatility: round(volatility, 2),
  };

  // R-squared estimate (higher with more factor exposure)
  const factorMagnitude = Math.abs(market) + Math.abs(size) * 0.5 + Math.abs(value) * 0.5 + Math.abs(momentum) * 0.3;
  const rSquared = round(Math.min(0.98, 0.5 + factorMagnitude * 0.15), 2);

  // Alpha estimate (rough — positive if portfolio has quality + momentum tilt)
  const alpha = round((quality * 2 + momentum * 3) / 100, 3);

  // Tracking error
  const trackingError = round(Math.sqrt(1 - rSquared) * 20, 2); // annualized

  // Risk decomposition
  const systematic = round(rSquared * 100, 1);
  const idiosyncratic = round((1 - rSquared) * 100, 1);

  const interpretation = generateInterpretation(exposures);

  return {
    exposures,
    rSquared,
    alpha,
    trackingError,
    interpretation,
    riskDecomposition: { systematic, idiosyncratic },
  };
}

function generateInterpretation(exp: FactorExposure): string {
  const parts: string[] = [];

  if (exp.market > 1.1) parts.push('aggressive market exposure (beta > 1.1)');
  else if (exp.market < 0.8) parts.push('defensive positioning (beta < 0.8)');

  if (exp.size > 0.2) parts.push('small-cap tilt');
  else if (exp.size < -0.2) parts.push('large-cap bias');

  if (exp.value > 0.2) parts.push('value-oriented');
  else if (exp.value < -0.2) parts.push('growth-oriented');

  if (exp.momentum > 0.2) parts.push('momentum-chasing');
  if (exp.quality > 0.2) parts.push('quality focus');
  if (exp.volatility > 0.3) parts.push('high-volatility exposure');
  else if (exp.volatility < -0.3) parts.push('low-volatility strategy');

  if (parts.length === 0) return 'Balanced factor exposure — diversified across all style dimensions.';
  return `Portfolio shows: ${parts.join(', ')}.`;
}

function emptyAnalysis(reason: string): FactorAnalysis {
  return {
    exposures: { market: 0, size: 0, value: 0, momentum: 0, quality: 0, volatility: 0 },
    rSquared: 0,
    alpha: 0,
    trackingError: 0,
    interpretation: reason,
    riskDecomposition: { systematic: 0, idiosyncratic: 100 },
  };
}

function round(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
