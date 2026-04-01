/**
 * Monte Carlo VaR/CVaR Risk Engine
 *
 * Pure TypeScript implementation — no external dependencies.
 * Provides Value-at-Risk, Conditional VaR, and stress testing
 * for portfolio risk analysis via Monte Carlo simulation.
 */

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
 * Cholesky decomposition of a symmetric positive-definite matrix.
 * Returns lower-triangular matrix L such that A = L * L^T.
 */
export function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }

      if (i === j) {
        const diag = matrix[i][i] - sum;
        if (diag <= 0) {
          // Matrix is not positive-definite; clamp to a tiny positive value
          // to keep the decomposition numerically stable.
          L[i][j] = Math.sqrt(Math.max(diag, 1e-10));
        } else {
          L[i][j] = Math.sqrt(diag);
        }
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }

  return L;
}

/**
 * Compute the covariance matrix from a 2-D array of return series.
 * `returns[i]` is the array of daily returns for asset i.
 */
export function covarianceMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  const T = Math.min(...returns.map((r) => r.length));

  // Means
  const means: number[] = returns.map((r) => {
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
        s += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
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
  const rng = new SeededRNG(12345);

  // --- Compute mean daily returns and covariance matrix ----
  const allReturns = positions.map((p) => p.returns);
  const T = Math.min(...allReturns.map((r) => r.length));

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
