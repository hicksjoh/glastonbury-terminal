/**
 * Correlation Matrix & Portfolio Analytics
 *
 * Failure policy: malformed input THROWS (consistent with
 * `matrixInverse` in black-litterman.ts). Degenerate-but-legitimate
 * input (fewer than two observations, zero variance) returns 0, which
 * is "undefined correlation", not a wrong answer. Nothing here ever
 * returns NaN.
 */

import { isFiniteNumber } from './finite';

/**
 * Trim a set of return series to their most recent common window.
 *
 * Series arrive oldest-first and all end at the latest available bar,
 * so aligning on the TAIL pairs like-for-like calendar dates. Trimming
 * from the front — which is what `Math.min(x.length, y.length)` inside
 * a correlation function silently does — correlates the oldest
 * observations of a long history against the whole of a short one.
 */
export function alignReturnSeries(returns: number[][]): number[][] {
  if (returns.length === 0) return [];
  const minLen = Math.min(...returns.map((r) => r.length));
  return returns.map((r) => (r.length === minLen ? r : r.slice(r.length - minLen)));
}

/**
 * True when every observation in a return series is usable. Callers
 * building a matrix from per-symbol histories should drop the symbols
 * that fail this rather than letting one bad series either throw or —
 * worse — be papered over with a fabricated zero correlation.
 */
export function isUsableReturnSeries(series: number[]): boolean {
  return Array.isArray(series) && series.every(isFiniteNumber);
}

/**
 * Pearson correlation between two equal-length arrays of returns.
 *
 * @throws if the arrays differ in length (mismatched inputs cannot be
 *   correlated — the previous behaviour truncated to the shorter one and
 *   returned 1.0 for `([1,2,3], [1,2])`).
 * @throws if any observation is non-finite.
 * @returns 0 when there are fewer than two observations, or when either
 *   series has zero variance (correlation is undefined, not zero-ish).
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length) {
    throw new Error(
      `pearsonCorrelation: series length mismatch (${x.length} vs ${y.length}). ` +
        'Align the series first — see alignReturnSeries().',
    );
  }
  const n = x.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!isFiniteNumber(xi) || !isFiniteNumber(yi)) {
      throw new Error(`pearsonCorrelation: non-finite observation at index ${i}.`);
    }
    sumX += xi;
    sumY += yi;
    sumXY += xi * yi;
    sumX2 += xi * xi;
    sumY2 += yi * yi;
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (!isFiniteNumber(denom) || denom === 0) return 0;

  const r = (n * sumXY - sumX * sumY) / denom;
  if (!isFiniteNumber(r)) return 0;
  // Guard against floating-point overshoot on perfectly collinear input.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Compute the NxN correlation matrix from arrays of returns.
 *
 * Ragged input is aligned to the most recent common window (see
 * alignReturnSeries) rather than silently front-truncated. Callers with
 * per-symbol histories of differing depth — /api/correlation does
 * exactly this — get date-aligned math instead of a misaligned one.
 *
 * @param returns - Array of return series (one per symbol)
 */
export function correlationMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  const aligned = alignReturnSeries(returns);
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      // Deliberately NOT wrapped in a try/catch. Substituting 0 for an
      // uncomputable pair reads downstream as "these two are
      // uncorrelated", which INFLATES diversificationScore — a confident
      // number manufactured from unusable data. Callers must drop the
      // bad series (see usableReturnSeries) rather than be handed a
      // fabricated correlation.
      const corr = pearsonCorrelation(aligned[i], aligned[j]);
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }

  return matrix;
}

/**
 * Weighted portfolio beta. A non-finite weight or beta contributes 0 /
 * defaults to 1.0 respectively rather than poisoning the total.
 */
export function portfolioBeta(weights: number[], betas: number[]): number {
  let beta = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!isFiniteNumber(w)) continue;
    const b = isFiniteNumber(betas[i]) ? betas[i] : 1;
    beta += w * b;
  }
  return isFiniteNumber(beta) ? beta : 0;
}

/**
 * Diversification score (0-100) based on average ABSOLUTE pairwise
 * correlation. Absolute is deliberate: two positions that move exactly
 * opposite are one bet expressed twice, not two independent bets.
 *
 * Lower avg |correlation| = higher diversification score.
 */
export function diversificationScore(matrix: number[][]): number {
  const n = matrix.length;
  if (n < 2) return 100;

  let totalCorr = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = matrix[i]?.[j];
      if (!isFiniteNumber(v)) continue; // an unknown pair contributes nothing
      totalCorr += Math.min(1, Math.abs(v));
      count++;
    }
  }

  const avgCorr = count > 0 ? totalCorr / count : 0;
  // 0 avg correlation = 100 score, 1 avg correlation = 0 score
  const score = Math.round(Math.max(0, Math.min(100, (1 - avgCorr) * 100)));
  return isFiniteNumber(score) ? score : 100;
}
