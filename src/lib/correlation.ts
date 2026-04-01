/**
 * Correlation Matrix & Portfolio Analytics
 */

/**
 * Pearson correlation between two arrays of returns
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute NxN correlation matrix from arrays of returns
 * @param returns - Array of return series (one per symbol)
 */
export function correlationMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const corr = pearsonCorrelation(returns[i], returns[j]);
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }

  return matrix;
}

/**
 * Weighted portfolio beta
 */
export function portfolioBeta(weights: number[], betas: number[]): number {
  let beta = 0;
  for (let i = 0; i < weights.length; i++) {
    beta += weights[i] * (betas[i] || 1);
  }
  return beta;
}

/**
 * Diversification score (0-100) based on average pairwise correlation
 * Lower avg correlation = higher diversification score
 */
export function diversificationScore(matrix: number[][]): number {
  const n = matrix.length;
  if (n < 2) return 100;

  let totalCorr = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      totalCorr += Math.abs(matrix[i][j]);
      count++;
    }
  }

  const avgCorr = count > 0 ? totalCorr / count : 0;
  // 0 avg correlation = 100 score, 1 avg correlation = 0 score
  return Math.round(Math.max(0, Math.min(100, (1 - avgCorr) * 100)));
}
