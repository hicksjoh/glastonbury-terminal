/**
 * Monte Carlo VaR/CVaR Risk Engine
 *
 * Pure TypeScript implementation — no external dependencies.
 * Provides Value-at-Risk, Conditional VaR, and stress testing
 * for portfolio risk analysis via Monte Carlo simulation.
 *
 * FAILURE POLICY
 * --------------
 * This engine THROWS on input it cannot decompose or simulate, matching
 * `matrixInverse` in black-litterman.ts. It used to clamp a negative
 * Cholesky pivot to 1e-10 and carry on, which meant an invalid
 * correlation structure produced plausible-looking, wrong VaR numbers
 * with no signal that anything was wrong. A risk number that is quietly
 * wrong is more dangerous than a risk number that is missing.
 */

import { isFiniteNumber } from './finite';

/** Thrown when a matrix cannot be Cholesky-decomposed. */
export class NotPositiveDefiniteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotPositiveDefiniteError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPosition {
  symbol: string;
  weight: number;
  returns: number[]; // historical daily returns
}

export interface MCConfig {
  simulations: number;
  horizon: number;
  confidenceLevels: number[];
}

export interface MonteCarloRiskResult {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  expectedReturn: number;
  percentiles: {
    p1: number;
    p5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  scenarios: number[];
  worstCase: number;
  bestCase: number;
  probabilityOfLoss: number;
}

export interface StressScenario {
  name: string;
  description: string;
  factorShocks: Record<string, number>; // symbol -> shock percentage
}

export interface StressResult {
  name: string;
  description: string;
  portfolioImpact: number;
  dollarLoss: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (Linear Congruential Generator)
// ---------------------------------------------------------------------------

class SeededRNG {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed;
  }

  /** Returns a pseudo-random number in [0, 1). */
  next(): number {
    // Numerical Recipes LCG parameters
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0x100000000;
  }

  /**
   * Box-Muller transform — returns two independent standard-normal variates.
   */
  nextGaussianPair(): [number, number] {
    let u1: number;
    let u2: number;

    // Ensure u1 is never exactly 0 (log(0) is -Infinity)
    do {
      u1 = this.next();
    } while (u1 === 0);
    u2 = this.next();

    const mag = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    return [mag * Math.cos(angle), mag * Math.sin(angle)];
  }
}

// ---------------------------------------------------------------------------
// Linear Algebra Helpers
// ---------------------------------------------------------------------------

/**
 * Cholesky decomposition of a symmetric positive-semi-definite matrix.
 * Returns lower-triangular L such that A = L * L^T.
 *
 * Positive-SEMI-definite input is accepted: two perfectly correlated
 * assets make a singular but perfectly legitimate covariance matrix, and
 * the standard convention is to zero that column. A pivot that is
 * genuinely negative — beyond floating-point noise — means the matrix is
 * not a valid covariance/correlation structure at all, and throws.
 *
 * @throws NotPositiveDefiniteError when a pivot is materially negative
 * @throws Error when the matrix is empty, non-square, asymmetric, or
 *   contains a non-finite entry
 */
export function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) throw new Error('choleskyDecomposition: matrix is empty.');

  let maxAbsDiag = 0;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== n) {
      throw new Error(`choleskyDecomposition: matrix must be square (row ${i} has length ${matrix[i]?.length}, expected ${n}).`);
    }
    for (let j = 0; j < n; j++) {
      if (!isFiniteNumber(matrix[i][j])) {
        throw new Error(`choleskyDecomposition: non-finite entry at [${i}][${j}].`);
      }
    }
    maxAbsDiag = Math.max(maxAbsDiag, Math.abs(matrix[i][i]));
  }

  // Symmetry, checked relative to the matrix scale so a 1e-4-magnitude
  // covariance matrix isn't held to an absolute 1e-12 bar.
  const symTol = 1e-9 * Math.max(1, maxAbsDiag);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > symTol) {
        throw new Error(
          `choleskyDecomposition: matrix must be symmetric ([${i}][${j}]=${matrix[i][j]} vs [${j}][${i}]=${matrix[j][i]}).`,
        );
      }
    }
  }

  // A pivot below -pivotTol is a real violation; one within +/-pivotTol
  // is rank deficiency (PSD) and gets a zero column.
  const pivotTol = 1e-12 * Math.max(1, maxAbsDiag);

  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }

      if (i === j) {
        const diag = matrix[i][i] - sum;
        if (diag < -pivotTol) {
          throw new NotPositiveDefiniteError(
            `choleskyDecomposition: matrix is not positive-definite — pivot ${diag} at index ${i}. ` +
              'This is not a valid covariance or correlation structure; the risk numbers derived ' +
              'from it would be meaningless.',
          );
        }
        L[i][j] = diag > 0 ? Math.sqrt(diag) : 0;
      } else if (L[j][j] === 0) {
        // A zero pivot is legitimate ONLY when the numerator vanishes too
        // — that is genuine rank deficiency, and the standard PSD
        // convention zeroes the column. A zero pivot with a NONZERO
        // residual means the matrix is indefinite: silently zeroing it
        // would discard that residual and return an L whose L*L^T is not
        // the input at all. [[0,1],[1,1]] (determinant -1) is the
        // smallest example.
        const residual = matrix[i][j] - sum;
        if (Math.abs(residual) > pivotTol) {
          throw new NotPositiveDefiniteError(
            `choleskyDecomposition: matrix is not positive-definite — zero pivot at index ${j} ` +
              `with non-zero residual ${residual} at [${i}][${j}]. The decomposition would not ` +
              'reconstruct the input, so every risk number derived from it would be meaningless.',
          );
        }
        L[i][j] = 0;
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }

  return L;
}

/**
 * Trim return series to their most recent common window. Series arrive
 * oldest-first, so tail-alignment pairs like-for-like calendar dates.
 * Front-truncation would correlate the oldest bars of a long history
 * against the whole of a short one.
 */
function alignSeries(returns: number[][]): number[][] {
  if (returns.length === 0) return [];
  const minLen = Math.min(...returns.map((r) => r.length));
  return returns.map((r) => (r.length === minLen ? r : r.slice(r.length - minLen)));
}

function assertUsableSeries(returns: number[][]): number[][] {
  const aligned = alignSeries(returns);
  if (aligned.length === 0) return aligned;
  const T = aligned[0].length;
  if (T < 2) {
    throw new Error(
      `covariance requires at least 2 observations per series (shortest series has ${T}).`,
    );
  }
  for (let i = 0; i < aligned.length; i++) {
    for (let t = 0; t < T; t++) {
      if (!isFiniteNumber(aligned[i][t])) {
        throw new Error(`non-finite return observation at series ${i}, index ${t}.`);
      }
    }
  }
  return aligned;
}

/**
 * Compute the covariance matrix from a 2-D array of return series.
 * `returns[i]` is the array of daily returns for asset i.
 *
 * Ragged input is tail-aligned. Uses the sample (n-1) denominator.
 *
 * @throws when any series has fewer than two observations, or holds a
 *   non-finite value (both used to yield a NaN matrix that then poisoned
 *   every downstream risk figure).
 */
export function covarianceMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  if (n === 0) return [];

  const aligned = assertUsableSeries(returns);
  const T = aligned[0].length;

  // Means
  const means: number[] = aligned.map((r) => {
    let s = 0;
    for (let t = 0; t < T; t++) s += r[t];
    return s / T;
  });

  // Covariance
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) {
        s += (aligned[i][t] - means[i]) * (aligned[j][t] - means[j]);
      }
      cov[i][j] = s / (T - 1);
      cov[j][i] = cov[i][j];
    }
  }

  return cov;
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Monte Carlo Simulation
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: MCConfig = {
  simulations: 10_000,
  horizon: 21,
  confidenceLevels: [0.95, 0.99],
};

/**
 * Run a full Monte Carlo VaR/CVaR simulation on a portfolio.
 *
 * Uses geometric Brownian motion with correlated asset returns
 * generated via Cholesky decomposition + Box-Muller normal variates.
 */
export function runMonteCarlo(
  positions: MCPosition[],
  portfolioValue: number,
  config: MCConfig = DEFAULT_CONFIG,
): MonteCarloRiskResult {
  const { simulations, horizon } = config;
  const n = positions.length;

  // --- Validate before simulating -------------------------------------
  // Everything below turns upstream broker/market data into a dollar risk
  // figure Wes reads off a dashboard. A NaN that survives to the output
  // renders as a confident-looking blank, so reject at the door.
  if (n === 0) throw new Error('runMonteCarlo: at least one position is required.');
  if (!isFiniteNumber(portfolioValue)) {
    throw new Error('runMonteCarlo: portfolioValue must be a finite number.');
  }
  if (!Number.isInteger(simulations) || simulations < 1) {
    throw new Error(`runMonteCarlo: simulations must be a positive integer (got ${simulations}).`);
  }
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new Error(`runMonteCarlo: horizon must be a positive integer (got ${horizon}).`);
  }
  for (const p of positions) {
    if (!isFiniteNumber(p.weight)) {
      throw new Error(`runMonteCarlo: non-finite weight for ${p.symbol}.`);
    }
  }

  const rng = new SeededRNG(12345);

  // --- Compute mean daily returns and covariance matrix ----
  const allReturns = assertUsableSeries(positions.map((p) => p.returns));
  const T = allReturns[0].length;

  const meanReturns: number[] = allReturns.map((r) => {
    let s = 0;
    for (let t = 0; t < T; t++) s += r[t];
    return s / T;
  });

  const cov = covarianceMatrix(allReturns);
  const L = choleskyDecomposition(cov);

  const weights = positions.map((p) => p.weight);

  // --- Simulate ---
  const scenarios: number[] = new Array(simulations);

  for (let sim = 0; sim < simulations; sim++) {
    // Cumulative portfolio return for this path
    let portfolioReturn = 1.0;

    for (let day = 0; day < horizon; day++) {
      // Generate n independent standard normals
      const z: number[] = new Array(n);
      for (let i = 0; i < n; i += 2) {
        const [g1, g2] = rng.nextGaussianPair();
        z[i] = g1;
        if (i + 1 < n) z[i + 1] = g2;
      }

      // Correlate via Cholesky: correlated = L * z
      const correlated: number[] = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k <= i; k++) {
          correlated[i] += L[i][k] * z[k];
        }
      }

      // Daily portfolio return (geometric Brownian motion step)
      let dayReturn = 0;
      for (let i = 0; i < n; i++) {
        const assetReturn = meanReturns[i] + correlated[i];
        dayReturn += weights[i] * assetReturn;
      }
      portfolioReturn *= 1 + dayReturn;
    }

    // Store final P&L as a fraction of portfolio value
    scenarios[sim] = (portfolioReturn - 1) * portfolioValue;
  }

  // --- Sort scenarios for percentile calculations ---
  const sorted = [...scenarios].sort((a, b) => a - b);

  // --- VaR & CVaR ---
  const idx95 = Math.floor(simulations * (1 - 0.95));
  const idx99 = Math.floor(simulations * (1 - 0.99));

  const var95 = -sorted[idx95]; // VaR is reported as positive loss
  const var99 = -sorted[idx99];

  // CVaR = average of losses beyond VaR threshold
  let cvar95Sum = 0;
  for (let i = 0; i < idx95; i++) cvar95Sum += sorted[i];
  const cvar95 = idx95 > 0 ? -(cvar95Sum / idx95) : var95;

  let cvar99Sum = 0;
  for (let i = 0; i < idx99; i++) cvar99Sum += sorted[i];
  const cvar99 = idx99 > 0 ? -(cvar99Sum / idx99) : var99;

  // --- Expected return ---
  let totalReturn = 0;
  for (let i = 0; i < simulations; i++) totalReturn += scenarios[i];
  const expectedReturn = totalReturn / simulations;

  // --- Percentiles ---
  const percentiles = {
    p1: percentile(sorted, 1),
    p5: percentile(sorted, 5),
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };

  // --- Probability of loss ---
  let lossCount = 0;
  for (let i = 0; i < simulations; i++) {
    if (scenarios[i] < 0) lossCount++;
  }
  const probabilityOfLoss = lossCount / simulations;

  return {
    var95,
    var99,
    cvar95,
    cvar99,
    expectedReturn,
    percentiles,
    scenarios,
    worstCase: sorted[0],
    bestCase: sorted[sorted.length - 1],
    probabilityOfLoss,
  };
}

// ---------------------------------------------------------------------------
// Stress Testing
// ---------------------------------------------------------------------------

const DEFAULT_STRESS_SCENARIOS: StressScenario[] = [
  {
    name: '2008 Financial Crisis',
    description:
      'Severe market downturn modeled after the 2008 GFC — broad equity declines of 40-55%.',
    factorShocks: {
      SPY: -0.50,
      QQQ: -0.45,
      IWM: -0.55,
      XLF: -0.55,
      XLK: -0.45,
      XLE: -0.40,
      XLV: -0.40,
      XLI: -0.50,
      XLP: -0.30,
      XLU: -0.25,
      TLT: 0.20,
      GLD: 0.05,
      DEFAULT: -0.45,
    },
  },
  {
    name: 'COVID March 2020',
    description:
      'Rapid pandemic sell-off — broad market -30% to -35%, travel and energy hit hardest.',
    factorShocks: {
      SPY: -0.34,
      QQQ: -0.28,
      IWM: -0.40,
      XLF: -0.35,
      XLK: -0.25,
      XLE: -0.50,
      XLV: -0.20,
      XLI: -0.35,
      XLP: -0.15,
      XLU: -0.25,
      TLT: 0.15,
      GLD: 0.03,
      DEFAULT: -0.32,
    },
  },
  {
    name: '2022 Rate Hike',
    description:
      'Aggressive Fed tightening cycle — growth/tech stocks down 30%, bonds down 15%, value down 10%.',
    factorShocks: {
      SPY: -0.20,
      QQQ: -0.33,
      IWM: -0.22,
      XLK: -0.30,
      XLF: -0.10,
      XLE: 0.30,
      XLV: -0.05,
      XLI: -0.10,
      XLP: -0.05,
      XLU: -0.05,
      TLT: -0.15,
      GLD: -0.03,
      DEFAULT: -0.18,
    },
  },
  {
    name: 'Flash Crash',
    description:
      'Sudden, uniform liquidity event — all assets drop ~8% in a single session.',
    factorShocks: {
      DEFAULT: -0.08,
    },
  },
];

/**
 * Apply stress scenarios to a portfolio and compute the dollar impact.
 *
 * For each scenario, every position is shocked by the factor specified
 * for its symbol (falling back to DEFAULT if no symbol-specific shock exists).
 */
export function stressTest(
  positions: MCPosition[],
  portfolioValue: number,
  scenarios: StressScenario[] = DEFAULT_STRESS_SCENARIOS,
): StressResult[] {
  return scenarios.map((scenario) => {
    let portfolioImpact = 0;

    for (const pos of positions) {
      const shock =
        scenario.factorShocks[pos.symbol] ??
        scenario.factorShocks['DEFAULT'] ??
        0;
      portfolioImpact += pos.weight * shock;
    }

    const dollarLoss = portfolioImpact * portfolioValue;

    return {
      name: scenario.name,
      description: scenario.description,
      portfolioImpact,
      dollarLoss,
    };
  });
}
