// Drift Regime Factor Detection Library
// Pure TypeScript, no external dependencies

export interface DriftRegime {
  regime: 'trending' | 'mean_reverting' | 'random_walk';
  hurstExponent: number;
  autocorrelation: number;
  confidence: number;
}

export interface FactorWeights {
  momentum: number;
  meanReversion: number;
  value: number;
  income: number;
}

export interface DriftScanResult {
  symbol: string;
  regime: DriftRegime;
  factorWeights: FactorWeights;
  recommendedStrategy: string;
}

/**
 * Linear regression returning slope and intercept.
 * Used internally for Hurst exponent estimation.
 */
function linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0.5, intercept: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/**
 * Rescaled Range (R/S) analysis to estimate the Hurst exponent.
 *
 * For multiple sub-period sizes (8, 16, 32, 64, 128, ... up to prices.length/2),
 * divides the series into non-overlapping sub-periods. For each sub-period,
 * computes cumulative deviations from the mean, the range R, and standard
 * deviation S. The rescaled range R/S is averaged across sub-periods for each
 * size. The Hurst exponent is the slope of log(R/S) vs log(size).
 *
 * H > 0.5 = trending (persistent)
 * H < 0.5 = mean-reverting (anti-persistent)
 * H ≈ 0.5 = random walk
 */
export function hurstExponent(prices: number[]): number {
  if (prices.length < 16) return 0.5;

  // Compute log returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= 0 || prices[i - 1] <= 0) {
      returns.push(0);
    } else {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  const maxSize = Math.floor(returns.length / 2);
  const logSizes: number[] = [];
  const logRS: number[] = [];

  // Sub-period sizes: 8, 16, 32, 64, 128, ...
  for (let size = 8; size <= maxSize; size *= 2) {
    const numSubPeriods = Math.floor(returns.length / size);
    if (numSubPeriods < 1) continue;

    let rsSum = 0;
    let validPeriods = 0;

    for (let p = 0; p < numSubPeriods; p++) {
      const start = p * size;
      const subPeriod = returns.slice(start, start + size);

      // Mean of sub-period
      let mean = 0;
      for (let i = 0; i < subPeriod.length; i++) {
        mean += subPeriod[i];
      }
      mean /= subPeriod.length;

      // Cumulative deviations from mean
      const cumDeviations: number[] = [];
      let cumSum = 0;
      for (let i = 0; i < subPeriod.length; i++) {
        cumSum += subPeriod[i] - mean;
        cumDeviations.push(cumSum);
      }

      // Range R = max(cumDeviations) - min(cumDeviations)
      let maxDev = -Infinity;
      let minDev = Infinity;
      for (let i = 0; i < cumDeviations.length; i++) {
        if (cumDeviations[i] > maxDev) maxDev = cumDeviations[i];
        if (cumDeviations[i] < minDev) minDev = cumDeviations[i];
      }
      const R = maxDev - minDev;

      // Standard deviation S
      let variance = 0;
      for (let i = 0; i < subPeriod.length; i++) {
        const diff = subPeriod[i] - mean;
        variance += diff * diff;
      }
      variance /= subPeriod.length;
      const S = Math.sqrt(variance);

      if (S > 0) {
        rsSum += R / S;
        validPeriods++;
      }
    }

    if (validPeriods > 0) {
      const avgRS = rsSum / validPeriods;
      logSizes.push(Math.log(size));
      logRS.push(Math.log(avgRS));
    }
  }

  if (logSizes.length < 2) return 0.5;

  const { slope } = linearRegression(logSizes, logRS);

  // Clamp to reasonable range [0, 1]
  return Math.max(0, Math.min(1, slope));
}

/**
 * Detect the drift regime of a price series.
 *
 * Uses the Hurst exponent and lag-1 autocorrelation of returns to classify
 * the series as trending, mean-reverting, or random walk.
 */
export function detectDriftRegime(prices: number[], window?: number): DriftRegime {
  const w = window ?? Math.min(prices.length, 120);
  const recentPrices = prices.slice(-w);

  if (recentPrices.length < 16) {
    return {
      regime: 'random_walk',
      hurstExponent: 0.5,
      autocorrelation: 0,
      confidence: 0,
    };
  }

  const H = hurstExponent(recentPrices);

  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < recentPrices.length; i++) {
    if (recentPrices[i] <= 0 || recentPrices[i - 1] <= 0) {
      returns.push(0);
    } else {
      returns.push(Math.log(recentPrices[i] / recentPrices[i - 1]));
    }
  }

  // Lag-1 autocorrelation
  const autocorrelation = lag1Autocorrelation(returns);

  // Classify regime
  let regime: 'trending' | 'mean_reverting' | 'random_walk';
  if (H > 0.6 && autocorrelation > 0.05) {
    regime = 'trending';
  } else if (H < 0.4 && autocorrelation < -0.05) {
    regime = 'mean_reverting';
  } else {
    regime = 'random_walk';
  }

  // Confidence based on distance of H from 0.5
  const confidence = Math.min(1, Math.abs(H - 0.5) * 5);

  return {
    regime,
    hurstExponent: H,
    autocorrelation,
    confidence,
  };
}

/**
 * Compute lag-1 autocorrelation of a series.
 */
function lag1Autocorrelation(series: number[]): number {
  if (series.length < 3) return 0;

  let mean = 0;
  for (let i = 0; i < series.length; i++) {
    mean += series[i];
  }
  mean /= series.length;

  let numerator = 0;
  let denominator = 0;

  for (let i = 1; i < series.length; i++) {
    numerator += (series[i] - mean) * (series[i - 1] - mean);
  }

  for (let i = 0; i < series.length; i++) {
    denominator += (series[i] - mean) * (series[i] - mean);
  }

  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Return adaptive factor weights based on the detected drift regime.
 *
 * - trending:       heavy momentum, light mean reversion
 * - mean_reverting: heavy mean reversion, light momentum
 * - random_walk:    favor value and income (regime-agnostic factors)
 */
export function adaptiveFactorWeights(regime: DriftRegime): FactorWeights {
  switch (regime.regime) {
    case 'trending':
      return { momentum: 0.6, meanReversion: 0.1, value: 0.2, income: 0.1 };
    case 'mean_reverting':
      return { momentum: 0.1, meanReversion: 0.6, value: 0.2, income: 0.1 };
    case 'random_walk':
      return { momentum: 0.1, meanReversion: 0.1, value: 0.3, income: 0.5 };
  }
}

/**
 * Scan multiple symbols, classify their drift regimes, and return results
 * sorted by confidence (highest first).
 */
export function driftRegimeScan(
  symbols: string[],
  priceData: Map<string, number[]>
): DriftScanResult[] {
  const results: DriftScanResult[] = [];

  for (const symbol of symbols) {
    const prices = priceData.get(symbol);
    if (!prices || prices.length < 16) continue;

    const regime = detectDriftRegime(prices);
    const factorWeights = adaptiveFactorWeights(regime);

    let recommendedStrategy: string;
    switch (regime.regime) {
      case 'trending':
        recommendedStrategy =
          `Momentum-driven: ride the trend with trailing stops. ` +
          `Hurst ${regime.hurstExponent.toFixed(3)} suggests persistent drift.`;
        break;
      case 'mean_reverting':
        recommendedStrategy =
          `Mean-reversion: fade extremes and target the moving average. ` +
          `Hurst ${regime.hurstExponent.toFixed(3)} suggests anti-persistent behavior.`;
        break;
      case 'random_walk':
        recommendedStrategy =
          `Regime-neutral: favor value and income factors. ` +
          `Hurst ${regime.hurstExponent.toFixed(3)} shows no exploitable drift pattern.`;
        break;
    }

    results.push({
      symbol,
      regime,
      factorWeights,
      recommendedStrategy,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.regime.confidence - a.regime.confidence);

  return results;
}
