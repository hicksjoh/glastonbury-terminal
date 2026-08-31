/**
 * Black-Litterman — linear-algebra identities and degenerate inputs.
 *
 * matrixInverse was already correct and already threw on a singular
 * matrix. What it did NOT do was notice a matrix full of NaN: the
 * singularity guard is `if (maxVal < 1e-12)`, and `NaN < 1e-12` is
 * false, so a NaN matrix sailed through and every downstream weight,
 * return and risk figure came out NaN. efficientFrontier(returns, cov, 1)
 * manufactured exactly that NaN via `t = 0 / (points - 1)`.
 */
import { describe, it, expect } from 'vitest';
import {
  matrixMultiply, transposeMatrix, matrixInverse,
  equilibriumReturns, blackLitterman, efficientFrontier, type View,
} from '../black-litterman';

function eye(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function expectMatrixClose(a: number[][], b: number[][], digits = 9) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i].length).toBe(b[i].length);
    for (let j = 0; j < a[i].length; j++) expect(a[i][j]).toBeCloseTo(b[i][j], digits);
  }
}

const COV3 = [
  [0.0400, 0.0120, 0.0060],
  [0.0120, 0.0900, 0.0180],
  [0.0060, 0.0180, 0.0625],
];

describe('matrixMultiply / transposeMatrix', () => {
  it('multiplies a known pair', () => {
    expectMatrixClose(matrixMultiply([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]], 12);
  });

  it('multiplies non-square shapes', () => {
    // (2x3) * (3x2) = (2x2)
    expectMatrixClose(
      matrixMultiply([[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]]),
      [[58, 64], [139, 154]], 12);
  });

  it('leaves a matrix unchanged when multiplied by the identity', () => {
    expectMatrixClose(matrixMultiply(COV3, eye(3)), COV3, 12);
    expectMatrixClose(matrixMultiply(eye(3), COV3), COV3, 12);
  });

  it('transposes, and transposing twice is the identity', () => {
    expectMatrixClose(transposeMatrix([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]], 12);
    expectMatrixClose(transposeMatrix(transposeMatrix(COV3)), COV3, 12);
  });

  it('throws on a dimension mismatch instead of reading undefined', () => {
    expect(() => matrixMultiply([[1, 2, 3]], [[1, 2], [3, 4]])).toThrow(/dimension|shape|mismatch/i);
  });
});

describe('matrixInverse — identity: A * A^-1 === I', () => {
  it('inverts a 2x2 exactly', () => {
    expectMatrixClose(matrixInverse([[4, 7], [2, 6]]), [[0.6, -0.7], [-0.2, 0.4]], 12);
  });

  it('reconstructs the identity for a realistic covariance matrix', () => {
    expectMatrixClose(matrixMultiply(COV3, matrixInverse(COV3)), eye(3), 9);
    expectMatrixClose(matrixMultiply(matrixInverse(COV3), COV3), eye(3), 9);
  });

  it('inverts the identity to itself', () => {
    expectMatrixClose(matrixInverse(eye(4)), eye(4), 12);
  });

  it('is its own inverse: inv(inv(A)) === A', () => {
    expectMatrixClose(matrixInverse(matrixInverse(COV3)), COV3, 8);
  });

  it('handles a 1x1 matrix', () => {
    expectMatrixClose(matrixInverse([[5]]), [[0.2]], 12);
  });

  it('THROWS on a singular matrix', () => {
    expect(() => matrixInverse([[1, 2], [2, 4]])).toThrow(/singular/i);
    expect(() => matrixInverse([[0, 0], [0, 0]])).toThrow(/singular/i);
  });

  it('THROWS on a NaN matrix instead of returning a NaN inverse', () => {
    // `maxVal < 1e-12` is false when maxVal is NaN, so the singularity
    // guard let this straight through.
    expect(() => matrixInverse([[Number.NaN, 0], [0, 1]])).toThrow(/finite/i);
    expect(() => matrixInverse([[1, Number.POSITIVE_INFINITY], [0, 1]])).toThrow(/finite/i);
  });

  it('THROWS on a non-square matrix', () => {
    expect(() => matrixInverse([[1, 2, 3], [4, 5, 6]])).toThrow(/square/i);
  });
});

describe('equilibriumReturns — pi = delta * Sigma * w', () => {
  it('matches a hand computation', () => {
    // Sigma * w for equal weights, times delta = 2.5
    const w = [1 / 3, 1 / 3, 1 / 3];
    const pi = equilibriumReturns(w, COV3, 2.5);
    const expected = COV3.map(row => 2.5 * (row[0] + row[1] + row[2]) / 3);
    for (let i = 0; i < 3; i++) expect(pi[i]).toBeCloseTo(expected[i], 12);
  });

  it('scales linearly with risk aversion', () => {
    const w = [0.5, 0.3, 0.2];
    const a = equilibriumReturns(w, COV3, 1);
    const b = equilibriumReturns(w, COV3, 4);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i] * 4, 12);
  });

  it('gives a higher equilibrium return to the higher-variance asset at equal weight', () => {
    const pi = equilibriumReturns([1 / 3, 1 / 3, 1 / 3], COV3, 2.5);
    // Asset 1 has variance 0.09, asset 0 has 0.04.
    expect(pi[1]).toBeGreaterThan(pi[0]);
  });
});

describe('blackLitterman', () => {
  const eq = equilibriumReturns([0.5, 0.3, 0.2], COV3, 2.5);

  it('reproduces the equilibrium when views carry no information', () => {
    // A view with (near) zero confidence must not move the posterior.
    const views: View[] = [{ assets: [1, 0, 0], expectedReturn: 999 }];
    const r = blackLitterman(eq, COV3, views, [1e-12]);
    for (let i = 0; i < 3; i++) expect(r.posteriorReturns[i]).toBeCloseTo(eq[i], 6);
  });

  it('pulls the posterior toward a confident view', () => {
    const bullish: View[] = [{ assets: [1, 0, 0], expectedReturn: eq[0] + 0.10 }];
    const r = blackLitterman(eq, COV3, bullish, [500]);
    expect(r.posteriorReturns[0]).toBeGreaterThan(eq[0]);
    expect(r.posteriorReturns[0]).toBeLessThan(eq[0] + 0.10 + 1e-9);
  });

  it('pushes the posterior down for a bearish view', () => {
    const bearish: View[] = [{ assets: [0, 1, 0], expectedReturn: eq[1] - 0.10 }];
    const r = blackLitterman(eq, COV3, bearish, [500]);
    expect(r.posteriorReturns[1]).toBeLessThan(eq[1]);
  });

  it('produces a symmetric, invertible posterior covariance', () => {
    const r = blackLitterman(eq, COV3, [{ assets: [1, -1, 0], expectedReturn: 0.02 }], [50]);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(r.posteriorCov[i][j]).toBeCloseTo(r.posteriorCov[j][i], 9);
    }
    expect(() => matrixInverse(r.posteriorCov)).not.toThrow();
  });

  it('returns long-only weights that sum to 1', () => {
    const r = blackLitterman(eq, COV3, [{ assets: [1, 0, -1], expectedReturn: 0.03 }], [50]);
    for (const w of r.optimalWeights) expect(w).toBeGreaterThanOrEqual(0);
    expect(r.optimalWeights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('reports risk, return and Sharpe consistently', () => {
    const r = blackLitterman(eq, COV3, [{ assets: [1, 0, 0], expectedReturn: 0.09 }], [50]);
    // expectedRisk must equal sqrt(w' Sigma w) for the weights reported.
    const sigW = COV3.map(row => row.reduce((s, v, j) => s + v * r.optimalWeights[j], 0));
    const variance = r.optimalWeights.reduce((s, w, i) => s + w * sigW[i], 0);
    expect(r.expectedRisk).toBeCloseTo(Math.sqrt(variance), 9);
    expect(r.expectedRisk).toBeGreaterThanOrEqual(0);
    expect(r.sharpeRatio).toBeCloseTo(r.expectedReturn / r.expectedRisk, 8);
  });

  it('emits no non-finite number anywhere in the result', () => {
    const r = blackLitterman(eq, COV3, [
      { assets: [1, 0, -1], expectedReturn: 0.03 },
      { assets: [0, 1, 0], expectedReturn: 0.05 },
    ], [30, 80]);
    const walk = (v: unknown): void => {
      if (typeof v === 'number') { expect(Number.isFinite(v)).toBe(true); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
  });

  it('THROWS when the confidence list does not match the view list', () => {
    // Mismatched lengths made Omega a k'-square matrix and every
    // subsequent multiply silently produced undefined -> NaN.
    expect(() => blackLitterman(eq, COV3, [
      { assets: [1, 0, 0], expectedReturn: 0.05 },
      { assets: [0, 1, 0], expectedReturn: 0.05 },
    ], [50])).toThrow(/confidence|length/i);
  });

  it('handles the no-views case by returning the equilibrium', () => {
    const r = blackLitterman(eq, COV3, [], []);
    for (let i = 0; i < 3; i++) expect(r.posteriorReturns[i]).toBeCloseTo(eq[i], 8);
  });

  it('THROWS on a singular covariance matrix rather than inventing weights', () => {
    const singular = [[0.04, 0.04], [0.04, 0.04]];
    expect(() => blackLitterman([0.05, 0.05], singular, [], [])).toThrow(/singular/i);
  });
});

describe('efficientFrontier', () => {
  const mu = [0.08, 0.12, 0.10];

  it('produces the requested number of points, all finite', () => {
    const f = efficientFrontier(mu, COV3, 20);
    expect(f.length).toBeGreaterThan(0);
    expect(f.length).toBeLessThanOrEqual(20);
    for (const p of f) {
      expect(Number.isFinite(p.risk)).toBe(true);
      expect(Number.isFinite(p.return)).toBe(true);
      expect(Number.isFinite(p.sharpe)).toBe(true);
      for (const w of p.weights) expect(Number.isFinite(w)).toBe(true);
    }
  });

  it('is sorted by ascending risk with non-decreasing return (it is a frontier)', () => {
    const f = efficientFrontier(mu, COV3, 20);
    for (let i = 1; i < f.length; i++) {
      expect(f[i].risk).toBeGreaterThanOrEqual(f[i - 1].risk);
      expect(f[i].return).toBeGreaterThanOrEqual(f[i - 1].return - 1e-12);
    }
  });

  it('returns long-only weights that sum to 1 at every point', () => {
    for (const p of efficientFrontier(mu, COV3, 12)) {
      for (const w of p.weights) expect(w).toBeGreaterThanOrEqual(0);
      expect(p.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('reports risk and Sharpe consistently with the weights it returns', () => {
    for (const p of efficientFrontier(mu, COV3, 8)) {
      const sigW = COV3.map(row => row.reduce((s, v, j) => s + v * p.weights[j], 0));
      const variance = p.weights.reduce((s, w, i) => s + w * sigW[i], 0);
      expect(p.risk).toBeCloseTo(Math.sqrt(Math.max(variance, 0)), 9);
      expect(p.sharpe).toBeCloseTo(p.return / p.risk, 7);
    }
  });

  it('does NOT emit a NaN point for points = 1', () => {
    // t = i / (points - 1) = 0/0 = NaN -> lambda NaN -> a NaN matrix that
    // matrixInverse happily "inverted", producing {risk: NaN, sharpe: 0}.
    const f = efficientFrontier(mu, COV3, 1);
    expect(f.length).toBe(1);
    expect(Number.isFinite(f[0].risk)).toBe(true);
    expect(Number.isFinite(f[0].return)).toBe(true);
    expect(f[0].weights.every(Number.isFinite)).toBe(true);
  });

  it('returns an empty frontier for zero or negative point counts', () => {
    expect(efficientFrontier(mu, COV3, 0)).toEqual([]);
    expect(efficientFrontier(mu, COV3, -5)).toEqual([]);
  });

  it('THROWS on a singular covariance matrix', () => {
    expect(() => efficientFrontier([0.08, 0.12], [[0.04, 0.04], [0.04, 0.04]], 5)).toThrow(/singular/i);
  });
});
