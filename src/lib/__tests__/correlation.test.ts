/**
 * Correlation analytics — identities, boundaries and malformed input.
 *
 * `pearsonCorrelation([1,2,3], [1,2])` used to return 1.0 — perfect
 * correlation, from mismatched input. Because correlationMatrix() feeds
 * the diversification score and the risk page heatmap, a silently wrong
 * pairwise number corrupts every downstream diversification and beta
 * figure with no visible symptom.
 */
import { describe, it, expect } from 'vitest';
import {
  pearsonCorrelation,
  correlationMatrix,
  portfolioBeta,
  diversificationScore,
  alignReturnSeries,
} from '../correlation';

const X = [0.01, -0.02, 0.03, 0.005, -0.011, 0.02, -0.004, 0.015];
const Y = [0.02, -0.01, 0.025, 0.001, -0.02, 0.03, 0.002, 0.011];

describe('pearsonCorrelation — identities that must hold exactly', () => {
  it('corr(x, x) === 1', () => {
    expect(pearsonCorrelation(X, X)).toBeCloseTo(1, 12);
  });

  it('corr(x, -x) === -1', () => {
    expect(pearsonCorrelation(X, X.map(v => -v))).toBeCloseTo(-1, 12);
  });

  it('is symmetric: corr(x, y) === corr(y, x)', () => {
    expect(pearsonCorrelation(X, Y)).toBeCloseTo(pearsonCorrelation(Y, X), 15);
  });

  it('is invariant to a positive affine transform of either series', () => {
    const base = pearsonCorrelation(X, Y);
    expect(pearsonCorrelation(X.map(v => 3 * v + 7), Y)).toBeCloseTo(base, 10);
    expect(pearsonCorrelation(X, Y.map(v => 0.5 * v - 2))).toBeCloseTo(base, 10);
  });

  it('flips sign under a negative affine transform', () => {
    const base = pearsonCorrelation(X, Y);
    expect(pearsonCorrelation(X.map(v => -3 * v + 7), Y)).toBeCloseTo(-base, 10);
  });

  it('is bounded to [-1, 1]', () => {
    const r = pearsonCorrelation(X, Y);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('matches a hand-computed reference value', () => {
    // x = [1,2,3,4,5], y = [2,4,5,4,5]
    // Sxy = 6, Sxx = 10, Syy = 6  ->  r = 6 / sqrt(60) = 0.7745966692
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.7745966692414834, 12);
  });

  it('is exactly 1 for a perfect positive linear relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
  });
});

describe('pearsonCorrelation — malformed input must not produce a number', () => {
  it('THROWS on mismatched lengths instead of returning 1.0', () => {
    expect(() => pearsonCorrelation([1, 2, 3], [1, 2])).toThrow(/length/i);
    expect(() => pearsonCorrelation([1, 2], [1, 2, 3])).toThrow(/length/i);
  });

  it('throws on a non-finite observation', () => {
    expect(() => pearsonCorrelation([1, 2, Number.NaN], [1, 2, 3])).toThrow(/finite/i);
    expect(() => pearsonCorrelation([1, 2, 3], [1, Number.POSITIVE_INFINITY, 3])).toThrow(/finite/i);
  });

  it('returns 0 for fewer than two observations (undefined, not wrong)', () => {
    expect(pearsonCorrelation([], [])).toBe(0);
    expect(pearsonCorrelation([1], [1])).toBe(0);
  });

  it('returns 0 for a zero-variance series rather than 0/0', () => {
    expect(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
    expect(pearsonCorrelation([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
    expect(pearsonCorrelation([5, 5, 5], [5, 5, 5])).toBe(0);
  });

  it('never returns NaN for any of the degenerate shapes', () => {
    const shapes: Array<[number[], number[]]> = [
      [[], []],
      [[0], [0]],
      [[0, 0], [0, 0]],
      [[1, 1, 1], [1, 2, 3]],
    ];
    for (const [a, b] of shapes) {
      expect(Number.isFinite(pearsonCorrelation(a, b))).toBe(true);
    }
  });
});

describe('alignReturnSeries', () => {
  it('trims every series to the most recent common window', () => {
    const aligned = alignReturnSeries([[1, 2, 3, 4, 5], [30, 40, 50], [100, 200, 300, 400]]);
    // Most recent 3 observations of each — NOT the first 3.
    expect(aligned).toEqual([[3, 4, 5], [30, 40, 50], [200, 300, 400]]);
  });

  it('is a no-op for equal-length series', () => {
    expect(alignReturnSeries([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
  });

  it('handles an empty input', () => {
    expect(alignReturnSeries([])).toEqual([]);
  });
});

describe('correlationMatrix', () => {
  it('has a unit diagonal', () => {
    const m = correlationMatrix([X, Y, X.map(v => -v)]);
    for (let i = 0; i < m.length; i++) expect(m[i][i]).toBe(1);
  });

  it('is symmetric', () => {
    const m = correlationMatrix([X, Y, X.map(v => v * 2 + 1)]);
    for (let i = 0; i < m.length; i++) {
      for (let j = 0; j < m.length; j++) {
        expect(m[i][j]).toBeCloseTo(m[j][i], 15);
      }
    }
  });

  it('reports -1 between a series and its negation', () => {
    const m = correlationMatrix([X, X.map(v => -v)]);
    expect(m[0][1]).toBeCloseTo(-1, 12);
  });

  it('aligns ragged series to the most recent common window instead of the oldest', () => {
    // Two symbols with different history depth, both ending today.
    // Front-truncation (the old behaviour) would correlate the OLDEST
    // observations of the long series against the whole short one —
    // i.e. compare different calendar dates.
    const long = [9, 9, 9, 9, 0.01, -0.02, 0.03, 0.005];
    const short = [0.01, -0.02, 0.03, 0.005];
    const m = correlationMatrix([long, short]);
    expect(m[0][1]).toBeCloseTo(1, 12);
  });

  it('never emits NaN, even for zero-variance or single-observation series', () => {
    const m = correlationMatrix([[1, 1, 1, 1], [1, 2, 3, 4], [4, 3, 2, 1]]);
    for (const row of m) for (const v of row) expect(Number.isFinite(v)).toBe(true);
  });

  it('returns an empty matrix for no input', () => {
    expect(correlationMatrix([])).toEqual([]);
  });

  it('returns [[1]] for a single series', () => {
    expect(correlationMatrix([X])).toEqual([[1]]);
  });
});

describe('portfolioBeta', () => {
  it('is the weighted average of the component betas', () => {
    expect(portfolioBeta([0.5, 0.5], [1.2, 0.8])).toBeCloseTo(1.0, 12);
    expect(portfolioBeta([0.25, 0.75], [2.0, 0.5])).toBeCloseTo(0.875, 12);
  });

  it('defaults a missing beta to 1.0', () => {
    expect(portfolioBeta([0.5, 0.5], [1.5])).toBeCloseTo(1.25, 12);
  });

  it('returns 0 for an empty portfolio', () => {
    expect(portfolioBeta([], [])).toBe(0);
  });

  it('never returns NaN when a weight is non-finite', () => {
    expect(Number.isFinite(portfolioBeta([Number.NaN, 0.5], [1.2, 0.8]))).toBe(true);
    expect(Number.isFinite(portfolioBeta([0.5, 0.5], [Number.NaN, 0.8]))).toBe(true);
  });
});

describe('diversificationScore', () => {
  it('scores a perfectly correlated pair at 0', () => {
    expect(diversificationScore([[1, 1], [1, 1]])).toBe(0);
  });

  it('scores an uncorrelated pair at 100', () => {
    expect(diversificationScore([[1, 0], [0, 1]])).toBe(100);
  });

  it('treats perfect NEGATIVE correlation as concentrated, not diversified', () => {
    // |−1| = 1, so a −1 pair scores the same as a +1 pair. Two positions
    // that move exactly opposite are one bet, not two.
    expect(diversificationScore([[1, -1], [-1, 1]])).toBe(0);
  });

  it('scores a half-correlated pair at 50', () => {
    expect(diversificationScore([[1, 0.5], [0.5, 1]])).toBe(50);
  });

  it('returns 100 for a single asset or empty matrix', () => {
    expect(diversificationScore([[1]])).toBe(100);
    expect(diversificationScore([])).toBe(100);
  });

  it('is bounded to [0, 100] and never NaN', () => {
    const inputs = [
      [[1, 2], [2, 1]],
      [[1, Number.NaN], [Number.NaN, 1]],
      [[1, -3], [-3, 1]],
    ];
    for (const m of inputs) {
      const s = diversificationScore(m);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
