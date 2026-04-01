// Black-Litterman Portfolio Optimizer
// Pure TypeScript — no external dependencies

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface View {
  assets: number[]; // P matrix row — weights for the view (e.g., [1, 0, -1] for asset 0 outperforms asset 2)
  expectedReturn: number; // Q value — the expected return of this view
}

export interface BLResult {
  posteriorReturns: number[];
  posteriorCov: number[][];
  optimalWeights: number[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
}

export interface FrontierPoint {
  risk: number;
  return: number;
  weights: number[];
  sharpe: number;
}

export interface MarketContext {
  macroRegime: string;
  vix: number;
  sentiment: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Linear Algebra Helpers
// ---------------------------------------------------------------------------

/** Multiply two matrices: a (m x n) * b (n x p) => (m x p) */
export function matrixMultiply(a: number[][], b: number[][]): number[][] {
  const m = a.length;
  const n = b.length;
  const p = b[0].length;
  const result: number[][] = Array.from({ length: m }, () => new Array(p).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

/** Transpose a matrix */
export function transposeMatrix(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0].length;
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j];
    }
  }
  return result;
}

/** Invert a square matrix using Gauss-Jordan elimination */
export function matrixInverse(m: number[][]): number[][] {
  const n = m.length;

  // Build augmented matrix [M | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = m[i][j];
    row[n + i] = 1;
    return row;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting — find the row with the largest absolute value in this column
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const absVal = Math.abs(aug[row][col]);
      if (absVal > maxVal) {
        maxVal = absVal;
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) {
      throw new Error('Matrix is singular or nearly singular — cannot invert');
    }

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // Scale pivot row so pivot element becomes 1
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate column in all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse from the right half of the augmented matrix
  return aug.map((row) => row.slice(n));
}

// ---------------------------------------------------------------------------
// Additional helpers
// ---------------------------------------------------------------------------

/** Multiply matrix (m x n) by column vector (n x 1) => column vector (m x 1) */
function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map((row) => row.reduce((sum, val, j) => sum + val * vec[j], 0));
}

/** Add two matrices element-wise */
function matAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}

/** Scale a matrix by a scalar */
function matScale(m: number[][], s: number): number[][] {
  return m.map((row) => row.map((val) => val * s));
}

/** Create an n x n identity matrix */
function eye(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0);
    row[i] = 1;
    return row;
  });
}

/** Create a diagonal matrix from a vector */
function diagMatrix(v: number[]): number[][] {
  const n = v.length;
  return Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0);
    row[i] = v[i];
    return row;
  });
}

// ---------------------------------------------------------------------------
// Core Black-Litterman Functions
// ---------------------------------------------------------------------------

/**
 * Compute implied equilibrium excess returns.
 *   pi = delta * Sigma * w_mkt
 *
 * @param marketWeights  Market-cap weights for each asset (must sum to 1)
 * @param covMatrix      Covariance matrix (n x n)
 * @param riskAversion   Risk aversion coefficient (default 2.5)
 */
export function equilibriumReturns(
  marketWeights: number[],
  covMatrix: number[][],
  riskAversion: number = 2.5,
): number[] {
  // pi = delta * Sigma * w
  const sigmaW = matVecMul(covMatrix, marketWeights);
  return sigmaW.map((v) => v * riskAversion);
}

/**
 * Run the Black-Litterman model.
 *
 * Posterior returns:
 *   mu_BL = [ (tau*Sigma)^-1 + P' * Omega^-1 * P ]^-1
 *           * [ (tau*Sigma)^-1 * pi  +  P' * Omega^-1 * Q ]
 *
 * Posterior covariance:
 *   Sigma_BL = [ (tau*Sigma)^-1 + P' * Omega^-1 * P ]^-1
 *
 * @param equilibrium     Implied equilibrium returns (from equilibriumReturns)
 * @param covMatrix       Covariance matrix (n x n)
 * @param views           Array of investor views
 * @param viewConfidence  Confidence for each view (higher = more certain)
 * @param tau             Scalar for uncertainty in the prior (default 0.05)
 */
export function blackLitterman(
  equilibrium: number[],
  covMatrix: number[][],
  views: View[],
  viewConfidence: number[],
  tau: number = 0.05,
): BLResult {
  const n = equilibrium.length; // number of assets
  const k = views.length; // number of views

  // Build P matrix (k x n) and Q vector (k x 1) from views
  const P: number[][] = views.map((v) => {
    // Pad or use the assets array directly — it must have length n
    const row = new Array(n).fill(0);
    for (let i = 0; i < v.assets.length && i < n; i++) {
      row[i] = v.assets[i];
    }
    return row;
  });

  const Q: number[] = views.map((v) => v.expectedReturn);

  // Build Omega (k x k diagonal) — uncertainty = 1 / confidence
  const omegaDiag: number[] = viewConfidence.map((c) => 1 / Math.max(c, 1e-10));
  const omega: number[][] = diagMatrix(omegaDiag);

  // tau * Sigma
  const tauSigma: number[][] = matScale(covMatrix, tau);

  // (tau * Sigma)^-1
  const tauSigmaInv: number[][] = matrixInverse(tauSigma);

  // Omega^-1
  const omegaInv: number[][] = matrixInverse(omega);

  // P' (n x k)
  const Pt: number[][] = transposeMatrix(P);

  // P' * Omega^-1 (n x k)
  const PtOmegaInv: number[][] = matrixMultiply(Pt, omegaInv);

  // P' * Omega^-1 * P (n x n)
  const PtOmegaInvP: number[][] = matrixMultiply(PtOmegaInv, P);

  // Posterior precision: (tau*Sigma)^-1 + P'*Omega^-1*P
  const posteriorPrecision: number[][] = matAdd(tauSigmaInv, PtOmegaInvP);

  // Posterior covariance: posteriorPrecision^-1
  const posteriorCov: number[][] = matrixInverse(posteriorPrecision);

  // Right-hand side:  (tau*Sigma)^-1 * pi  +  P' * Omega^-1 * Q
  const term1: number[] = matVecMul(tauSigmaInv, equilibrium);
  const term2: number[] = matVecMul(PtOmegaInv, Q);
  const rhs: number[] = term1.map((v, i) => v + term2[i]);

  // Posterior returns
  const posteriorReturns: number[] = matVecMul(posteriorCov, rhs);

  // Optimal weights via mean-variance: w* = (delta * Sigma)^-1 * mu_BL
  // Using delta = 2.5 as default risk aversion for weight derivation
  const delta = 2.5;
  const deltaSigmaInv = matrixInverse(matScale(covMatrix, delta));
  let rawWeights = matVecMul(deltaSigmaInv, posteriorReturns);

  // No short selling: clamp negatives to 0, then normalize to sum to 1
  rawWeights = rawWeights.map((w) => Math.max(w, 0));
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  const optimalWeights =
    weightSum > 1e-12 ? rawWeights.map((w) => w / weightSum) : rawWeights;

  // Portfolio statistics
  const expectedReturn = optimalWeights.reduce(
    (sum, w, i) => sum + w * posteriorReturns[i],
    0,
  );

  // Portfolio variance: w' * Sigma * w
  const sigmaW = matVecMul(covMatrix, optimalWeights);
  const variance = optimalWeights.reduce((sum, w, i) => sum + w * sigmaW[i], 0);
  const expectedRisk = Math.sqrt(Math.max(variance, 0));

  const sharpeRatio = expectedRisk > 1e-12 ? expectedReturn / expectedRisk : 0;

  return {
    posteriorReturns,
    posteriorCov,
    optimalWeights,
    expectedReturn,
    expectedRisk,
    sharpeRatio,
  };
}

// ---------------------------------------------------------------------------
// Efficient Frontier
// ---------------------------------------------------------------------------

/**
 * Generate points along the efficient frontier by sweeping risk aversion.
 *
 * For each risk-aversion level lambda, the optimal unconstrained portfolio is:
 *   w = (lambda * Sigma)^-1 * mu
 *
 * Weights are clamped (no short selling) and normalized.
 *
 * @param returns    Expected return for each asset
 * @param covMatrix  Covariance matrix (n x n)
 * @param points     Number of frontier points to generate (default 20)
 */
export function efficientFrontier(
  returns: number[],
  covMatrix: number[][],
  points: number = 20,
): FrontierPoint[] {
  const frontier: FrontierPoint[] = [];

  // Sweep risk aversion from aggressive (0.1) to conservative (100)
  const lambdaMin = 0.1;
  const lambdaMax = 100;

  for (let i = 0; i < points; i++) {
    // Log-space sweep gives better distribution of frontier points
    const t = i / (points - 1);
    const lambda = lambdaMin * Math.pow(lambdaMax / lambdaMin, t);

    const lambdaSigmaInv = matrixInverse(matScale(covMatrix, lambda));
    let weights = matVecMul(lambdaSigmaInv, returns);

    // No short selling
    weights = weights.map((w) => Math.max(w, 0));
    const wSum = weights.reduce((a, b) => a + b, 0);
    if (wSum > 1e-12) {
      weights = weights.map((w) => w / wSum);
    }

    // Portfolio return
    const portReturn = weights.reduce((sum, w, j) => sum + w * returns[j], 0);

    // Portfolio risk
    const sigW = matVecMul(covMatrix, weights);
    const portVariance = weights.reduce((sum, w, j) => sum + w * sigW[j], 0);
    const portRisk = Math.sqrt(Math.max(portVariance, 0));

    const sharpe = portRisk > 1e-12 ? portReturn / portRisk : 0;

    frontier.push({
      risk: portRisk,
      return: portReturn,
      weights,
      sharpe,
    });
  }

  // Sort by risk ascending (should already be roughly sorted, but guarantee it)
  frontier.sort((a, b) => a.risk - b.risk);

  // Remove dominated points to keep only the efficient part
  const efficient: FrontierPoint[] = [];
  let maxReturn = -Infinity;
  for (const pt of frontier) {
    if (pt.return >= maxReturn - 1e-12) {
      efficient.push(pt);
      maxReturn = Math.max(maxReturn, pt.return);
    }
  }

  return efficient;
}
