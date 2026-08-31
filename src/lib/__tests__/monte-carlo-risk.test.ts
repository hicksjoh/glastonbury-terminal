/**
 * Monte Carlo VaR/CVaR engine — linear-algebra identities, statistical
 * properties, and degenerate inputs.
 *
 * `choleskyDecomposition([[1,2],[2,1]])` (not positive-definite) used to
 * return [[1,0],[2,1e-5]] — it clamped the negative pivot to a fudge
 * value instead of rejecting. Correlated-risk simulations then ran on an
 * invalid decomposition and produced plausible-looking, wrong VaR.
 * `matrixInverse` in black-litterman.ts throws on a singular matrix;
 * these failure modes are now consistent.
 */
import { describe, it, expect } from 'vitest';
import {
  choleskyDecomposition,
  covarianceMatrix,
  runMonteCarlo,
  stressTest,
  NotPositiveDefiniteError,
  type MCPosition,
} from '../monte-carlo-risk';

/** L * L^T */
function reconstruct(L: number[][]): number[][] {
  const n = L.length;
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += L[i][k] * L[j][k];
      out[i][j] = s;
    }
  }
  return out;
}

function expectMatrixClose(a: number[][], b: number[][], digits = 10) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      expect(a[i][j]).toBeCloseTo(b[i][j], digits);
    }
  }
}

describe('choleskyDecomposition — identity: L * L^T === Sigma', () => {
  it('reconstructs a 2x2 positive-definite matrix exactly', () => {
    const A = [[4, 2], [2, 3]];
    const L = choleskyDecomposition(A);
    expectMatrixClose(reconstruct(L), A, 12);
  });

  it('reconstructs a 3x3 positive-definite matrix', () => {
    const A = [[25, 15, -5], [15, 18, 0], [-5, 0, 11]];
    const L = choleskyDecomposition(A);
    // Textbook answer for this classic example.
    expectMatrixClose(L, [[5, 0, 0], [3, 3, 0], [-1, 1, 3]], 12);
    expectMatrixClose(reconstruct(L), A, 10);
  });

  it('returns a lower-triangular matrix (strict upper triangle is zero)', () => {
    const L = choleskyDecomposition([[25, 15, -5], [15, 18, 0], [-5, 0, 11]]);
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) expect(L[i][j]).toBe(0);
    }
  });

  it('handles the 1x1 case', () => {
    expect(choleskyDecomposition([[9]])).toEqual([[3]]);
  });

  it('handles the identity matrix', () => {
    expectMatrixClose(choleskyDecomposition([[1, 0], [0, 1]]), [[1, 0], [0, 1]], 15);
  });

  it('reconstructs a realistic covariance matrix of daily returns', () => {
    const A = [
      [0.000225, 0.000135, 0.00006],
      [0.000135, 0.000324, 0.000081],
      [0.00006, 0.000081, 0.000144],
    ];
    expectMatrixClose(reconstruct(choleskyDecomposition(A)), A, 14);
  });
});

describe('choleskyDecomposition — REJECTS what it cannot decompose', () => {
  it('throws on a non-positive-definite matrix instead of clamping', () => {
    // [[1,2],[2,1]] has eigenvalues 3 and -1. The old code returned
    // [[1,0],[2,0.00001]].
    expect(() => choleskyDecomposition([[1, 2], [2, 1]])).toThrow(NotPositiveDefiniteError);
    expect(() => choleskyDecomposition([[1, 2], [2, 1]])).toThrow(/positive[- ]definite/i);
  });

  it('throws on a negative variance on the diagonal', () => {
    expect(() => choleskyDecomposition([[-1, 0], [0, 1]])).toThrow(NotPositiveDefiniteError);
  });

  it('throws on a correlation matrix that violates the triangle inequality', () => {
    // corr(A,B)=0.9, corr(A,C)=0.9, corr(B,C)=-0.9 is not a valid
    // correlation structure — no three assets can be related this way.
    const impossible = [[1, 0.9, 0.9], [0.9, 1, -0.9], [0.9, -0.9, 1]];
    expect(() => choleskyDecomposition(impossible)).toThrow(NotPositiveDefiniteError);
  });

  it('throws on a non-square matrix', () => {
    expect(() => choleskyDecomposition([[1, 2, 3], [4, 5, 6]])).toThrow(/square/i);
  });

  it('throws on an asymmetric matrix', () => {
    expect(() => choleskyDecomposition([[4, 2], [1, 3]])).toThrow(/symmetric/i);
  });

  it('throws on a non-finite entry rather than propagating NaN', () => {
    expect(() => choleskyDecomposition([[Number.NaN, 0], [0, 1]])).toThrow(/finite/i);
    expect(() => choleskyDecomposition([[1, 0], [0, Number.POSITIVE_INFINITY]])).toThrow(/finite/i);
  });

  it('throws on an empty matrix', () => {
    expect(() => choleskyDecomposition([])).toThrow();
  });

  it('ACCEPTS a positive-SEMI-definite (rank-deficient) matrix', () => {
    // Two perfectly correlated assets: singular but legitimate market
    // data. Rejecting this would break real portfolios.
    const psd = [[1, 1], [1, 1]];
    const L = choleskyDecomposition(psd);
    expectMatrixClose(reconstruct(L), psd, 12);
    for (const row of L) for (const v of row) expect(Number.isFinite(v)).toBe(true);
  });

  it('throws when a zero pivot has a NONZERO residual (indefinite, not merely rank-deficient)', () => {
    // [[0,1],[1,1]] has determinant -1, so it is indefinite. The first
    // pivot is 0; naively zeroing the rest of that column discards the
    // residual 1 and returns [[0,0],[0,1]], whose L*L^T is NOT the input.
    // Zeroing a column is only legitimate when the numerator is zero too.
    expect(() => choleskyDecomposition([[0, 1], [1, 1]])).toThrow(NotPositiveDefiniteError);
    expect(() => choleskyDecomposition([[0, 2], [2, 0]])).toThrow(NotPositiveDefiniteError);
  });

  it('every accepted matrix genuinely reconstructs (L * L^T === input)', () => {
    // The real contract behind the PSD allowance.
    const accepted = [
      [[9]], [[0]], [[1, 0], [0, 1]], [[1, 1], [1, 1]], [[4, 2], [2, 3]],
      [[0, 0], [0, 1]], [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      [[25, 15, -5], [15, 18, 0], [-5, 0, 11]],
    ];
    for (const A of accepted) {
      expectMatrixClose(reconstruct(choleskyDecomposition(A)), A, 10);
    }
  });

  it('never emits a non-finite value for any accepted matrix', () => {
    const accepted = [[[9]], [[1, 0], [0, 1]], [[1, 1], [1, 1]], [[4, 2], [2, 3]]];
    for (const A of accepted) {
      for (const row of choleskyDecomposition(A)) {
        for (const v of row) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('covarianceMatrix', () => {
  it('matches the sample covariance formula (n-1 denominator)', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 5, 4, 5];
    // var(x) = 2.5, var(y) = 1.5, cov(x,y) = 1.5
    const c = covarianceMatrix([x, y]);
    expect(c[0][0]).toBeCloseTo(2.5, 12);
    expect(c[1][1]).toBeCloseTo(1.5, 12);
    expect(c[0][1]).toBeCloseTo(1.5, 12);
  });

  it('is symmetric', () => {
    const c = covarianceMatrix([[1, 2, 3, 4], [4, 3, 3, 1], [2, 2, 5, 1]]);
    for (let i = 0; i < c.length; i++) {
      for (let j = 0; j < c.length; j++) expect(c[i][j]).toBeCloseTo(c[j][i], 15);
    }
  });

  it('has a non-negative diagonal (variances)', () => {
    const c = covarianceMatrix([[1, 2, 3, 4], [4, 3, 3, 1]]);
    for (let i = 0; i < c.length; i++) expect(c[i][i]).toBeGreaterThanOrEqual(0);
  });

  it('produces a positive-semi-definite matrix Cholesky accepts', () => {
    const c = covarianceMatrix([
      [0.01, -0.02, 0.015, 0.004, -0.008, 0.011],
      [0.012, -0.015, 0.02, 0.001, -0.01, 0.009],
      [-0.005, 0.01, -0.008, 0.002, 0.006, -0.004],
    ]);
    expect(() => choleskyDecomposition(c)).not.toThrow();
  });

  it('is zero for a constant series', () => {
    const c = covarianceMatrix([[5, 5, 5, 5], [1, 2, 3, 4]]);
    expect(c[0][0]).toBe(0);
    expect(c[0][1]).toBe(0);
  });

  it('aligns ragged series on their most recent common window', () => {
    const long = [99, 99, 1, 2, 3, 4, 5];
    const short = [1, 2, 3, 4, 5];
    const c = covarianceMatrix([long, short]);
    // Tail-aligned they are identical, so cov === var === 2.5.
    expect(c[0][1]).toBeCloseTo(2.5, 12);
  });

  it('throws when a series has fewer than two observations', () => {
    expect(() => covarianceMatrix([[0.01]])).toThrow(/two observations|at least 2/i);
    expect(() => covarianceMatrix([[0.01, 0.02], [0.03]])).toThrow(/two observations|at least 2/i);
  });

  it('throws on a non-finite observation', () => {
    expect(() => covarianceMatrix([[1, 2, Number.NaN], [1, 2, 3]])).toThrow(/finite/i);
  });

  it('returns an empty matrix for empty input', () => {
    expect(covarianceMatrix([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const CONFIG = { simulations: 2_000, horizon: 21, confidenceLevels: [0.95, 0.99] };

function series(mean: number, amplitude: number, n = 60): number[] {
  // Deterministic pseudo-series — no Math.random() in a test.
  return Array.from({ length: n }, (_, i) => mean + amplitude * Math.sin(i * 1.7));
}

describe('runMonteCarlo — determinism and known answers', () => {
  it('is deterministic: identical inputs give byte-identical output', () => {
    const positions: MCPosition[] = [
      { symbol: 'A', weight: 0.6, returns: series(0.0004, 0.01) },
      { symbol: 'B', weight: 0.4, returns: series(0.0002, 0.015) },
    ];
    const a = runMonteCarlo(positions, 1_000_000, CONFIG);
    const b = runMonteCarlo(positions, 1_000_000, CONFIG);
    expect(a.var95).toBe(b.var95);
    expect(a.cvar99).toBe(b.cvar99);
    expect(a.scenarios).toEqual(b.scenarios);
  });

  it('collapses to the exact deterministic compound return with zero variance', () => {
    // Constant returns -> zero covariance -> L = 0 -> no randomness at all.
    // Every path must be exactly (1 + mu)^horizon - 1.
    const mu = 0.001;
    const positions: MCPosition[] = [{ symbol: 'A', weight: 1, returns: new Array(50).fill(mu) }];
    const r = runMonteCarlo(positions, 100_000, { ...CONFIG, simulations: 50, horizon: 10 });
    const expected = (Math.pow(1 + mu, 10) - 1) * 100_000;
    expect(r.expectedReturn).toBeCloseTo(expected, 6);
    expect(r.worstCase).toBeCloseTo(expected, 6);
    expect(r.bestCase).toBeCloseTo(expected, 6);
    expect(r.probabilityOfLoss).toBe(0);
  });

  it('scales linearly with portfolio value', () => {
    const positions: MCPosition[] = [{ symbol: 'A', weight: 1, returns: series(0.0003, 0.012) }];
    const small = runMonteCarlo(positions, 100_000, CONFIG);
    const big = runMonteCarlo(positions, 1_000_000, CONFIG);
    expect(big.var95).toBeCloseTo(small.var95 * 10, 6);
    expect(big.expectedReturn).toBeCloseTo(small.expectedReturn * 10, 6);
  });
});

describe('runMonteCarlo — risk-measure invariants', () => {
  const positions: MCPosition[] = [
    { symbol: 'A', weight: 0.5, returns: series(0.0005, 0.014) },
    { symbol: 'B', weight: 0.3, returns: series(0.0002, 0.02) },
    { symbol: 'C', weight: 0.2, returns: series(-0.0001, 0.008) },
  ];
  const r = runMonteCarlo(positions, 1_000_000, CONFIG);

  it('99% VaR is at least as large a loss as 95% VaR', () => {
    expect(r.var99).toBeGreaterThanOrEqual(r.var95);
  });

  it('CVaR is at least as large a loss as VaR at the same confidence', () => {
    expect(r.cvar95).toBeGreaterThanOrEqual(r.var95);
    expect(r.cvar99).toBeGreaterThanOrEqual(r.var99);
  });

  it('percentiles are monotonically non-decreasing', () => {
    const p = r.percentiles;
    const ordered = [p.p1, p.p5, p.p10, p.p25, p.p50, p.p75, p.p90, p.p95, p.p99];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1]);
    }
  });

  it('worstCase <= p1 and bestCase >= p99', () => {
    expect(r.worstCase).toBeLessThanOrEqual(r.percentiles.p1);
    expect(r.bestCase).toBeGreaterThanOrEqual(r.percentiles.p99);
  });

  it('probabilityOfLoss is a probability', () => {
    expect(r.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(r.probabilityOfLoss).toBeLessThanOrEqual(1);
  });

  it('emits exactly `simulations` scenarios, all finite', () => {
    expect(r.scenarios).toHaveLength(CONFIG.simulations);
    for (const s of r.scenarios) expect(Number.isFinite(s)).toBe(true);
  });

  it('emits no non-finite number anywhere in the result', () => {
    const walk = (v: unknown): void => {
      if (typeof v === 'number') { expect(Number.isFinite(v)).toBe(true); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
  });

  it('a higher-volatility portfolio has a larger VaR', () => {
    const calm = runMonteCarlo(
      [{ symbol: 'A', weight: 1, returns: series(0.0003, 0.005) }], 1_000_000, CONFIG);
    const wild = runMonteCarlo(
      [{ symbol: 'A', weight: 1, returns: series(0.0003, 0.05) }], 1_000_000, CONFIG);
    expect(wild.var95).toBeGreaterThan(calm.var95);
  });
});

describe('runMonteCarlo — degenerate inputs fail loudly, not silently', () => {
  const ok: MCPosition[] = [{ symbol: 'A', weight: 1, returns: series(0.0003, 0.01) }];

  it('throws on no positions', () => {
    expect(() => runMonteCarlo([], 100_000, CONFIG)).toThrow(/position/i);
  });

  it('throws when a position has fewer than two observations', () => {
    expect(() => runMonteCarlo([{ symbol: 'A', weight: 1, returns: [0.01] }], 100_000, CONFIG))
      .toThrow(/two observations|at least 2/i);
  });

  it('throws on a non-finite portfolio value', () => {
    expect(() => runMonteCarlo(ok, Number.NaN, CONFIG)).toThrow(/finite/i);
  });

  it('throws on a non-finite or non-positive weight set', () => {
    expect(() => runMonteCarlo([{ symbol: 'A', weight: Number.NaN, returns: series(0.0003, 0.01) }], 100_000, CONFIG))
      .toThrow(/weight/i);
  });

  it('throws on zero or negative simulations / horizon', () => {
    expect(() => runMonteCarlo(ok, 100_000, { ...CONFIG, simulations: 0 })).toThrow(/simulations/i);
    expect(() => runMonteCarlo(ok, 100_000, { ...CONFIG, horizon: 0 })).toThrow(/horizon/i);
  });

  it('throws on a non-finite return observation', () => {
    expect(() => runMonteCarlo(
      [{ symbol: 'A', weight: 1, returns: [0.01, Number.NaN, 0.02] }], 100_000, CONFIG))
      .toThrow(/finite/i);
  });

  it('handles an odd number of assets (the Box-Muller pairing edge case)', () => {
    const three: MCPosition[] = [
      { symbol: 'A', weight: 0.34, returns: series(0.0003, 0.01) },
      { symbol: 'B', weight: 0.33, returns: series(0.0002, 0.012) },
      { symbol: 'C', weight: 0.33, returns: series(0.0004, 0.009) },
    ];
    const r = runMonteCarlo(three, 100_000, { ...CONFIG, simulations: 500 });
    for (const s of r.scenarios) expect(Number.isFinite(s)).toBe(true);
  });
});

describe('stressTest', () => {
  const positions: MCPosition[] = [
    { symbol: 'SPY', weight: 0.5, returns: series(0.0003, 0.01) },
    { symbol: 'TLT', weight: 0.5, returns: series(0.0001, 0.006) },
  ];

  it('applies the symbol-specific shock, weighted', () => {
    const [only] = stressTest(positions, 1_000_000, [{
      name: 'T', description: 'd', factorShocks: { SPY: -0.5, TLT: 0.2 },
    }]);
    // 0.5*(-0.5) + 0.5*(0.2) = -0.15
    expect(only.portfolioImpact).toBeCloseTo(-0.15, 12);
    expect(only.dollarLoss).toBeCloseTo(-150_000, 6);
  });

  it('falls back to DEFAULT for an unlisted symbol', () => {
    const [only] = stressTest(positions, 100_000, [{
      name: 'T', description: 'd', factorShocks: { SPY: -0.5, DEFAULT: -0.1 },
    }]);
    // 0.5*(-0.5) + 0.5*(-0.1) = -0.30
    expect(only.portfolioImpact).toBeCloseTo(-0.3, 12);
  });

  it('applies a zero shock when neither the symbol nor DEFAULT is listed', () => {
    const [only] = stressTest(positions, 100_000, [{ name: 'T', description: 'd', factorShocks: {} }]);
    expect(only.portfolioImpact).toBe(0);
    expect(only.dollarLoss).toBe(0);
  });

  it('runs the four built-in historical scenarios and never emits NaN', () => {
    const results = stressTest(positions, 1_000_000);
    expect(results.length).toBe(4);
    for (const r of results) {
      expect(Number.isFinite(r.portfolioImpact)).toBe(true);
      expect(Number.isFinite(r.dollarLoss)).toBe(true);
    }
  });

  it('models 2008, COVID and the 2022 rate hike as losses for an equity book', () => {
    const equity: MCPosition[] = [{ symbol: 'SPY', weight: 1, returns: series(0.0003, 0.01) }];
    for (const r of stressTest(equity, 1_000_000)) {
      expect(r.portfolioImpact).toBeLessThan(0);
    }
  });
});
