/**
 * The NaN-through-guards sweep.
 *
 * Every relational comparison against NaN is false, so a chain written
 * as `if (x > a) ... else if (x > b) ... else <confident claim>` routes
 * garbage input to whatever the final `else` says. The Kelly sizer's
 * "Strong edge detected" was one instance of this; these are the rest,
 * found by sweeping the codebase for the shape rather than patching the
 * two known sites.
 *
 * Note that `??` does NOT protect against it: `NaN ?? 20` is NaN, since
 * nullish coalescing only tests null and undefined.
 *
 * The rule these tests enforce: a scoring or classification function
 * must not turn unusable input into a confident answer, and must never
 * emit NaN in a field the API contractually promises as a number.
 */
import { describe, it, expect } from 'vitest';
import { detectRegime } from '../regime-detector';
import { fedWatchModel } from '../macro-regime';
import { detectDriftRegime } from '../drift-regime';
import { testCointegration } from '../pairs-trading';
import { findNonFiniteNumbers, isFiniteNumber, allFinite, finiteOr } from '../finite';

const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

/** Assert no NaN/Infinity anywhere in a payload. */
function expectAllFinite(payload: unknown, label: string) {
  expect(findNonFiniteNumbers(payload), label).toEqual([]);
}

describe('finite.ts helpers', () => {
  it('isFiniteNumber accepts only real finite numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
    for (const v of NON_FINITE) expect(isFiniteNumber(v)).toBe(false);
    for (const v of ['1', null, undefined, {}, [], true]) expect(isFiniteNumber(v)).toBe(false);
  });

  it('allFinite is true only when every value is finite', () => {
    expect(allFinite(1, 2, 3)).toBe(true);
    expect(allFinite(1, Number.NaN, 3)).toBe(false);
    expect(allFinite()).toBe(true);
  });

  it('finiteOr falls back for anything unusable — unlike ??', () => {
    expect(finiteOr(5, 20)).toBe(5);
    expect(finiteOr(Number.NaN, 20)).toBe(20);
    expect(finiteOr(null, 20)).toBe(20);
    expect(finiteOr('7', 20)).toBe(20);
    // The bug this exists to prevent:
    expect(Number.NaN ?? 20).toBeNaN();
  });

  it('findNonFiniteNumbers reports the dotted path of every offender', () => {
    expect(findNonFiniteNumbers({ a: 1, b: { c: Number.NaN }, d: [1, Number.POSITIVE_INFINITY] }))
      .toEqual(['$.b.c', '$.d[1]']);
    expect(findNonFiniteNumbers({ a: 1, b: 'x', c: null })).toEqual([]);
  });
});

describe('detectRegime — a bad VIX must not read as maximum fear', () => {
  it('does not classify NaN inputs as bear_high_vol', () => {
    // `vix ?? 20` does not catch NaN, so every VIX comparison was false
    // and the final `else` added 3 points to bear_high_vol — the most
    // fearful regime — which the trade guard then uses to cut position
    // size to 40%.
    for (const bad of NON_FINITE) {
      const r = detectRegime(bad, null, null, null);
      expect(r.regime, `vix=${bad}`).not.toBe('bear_high_vol');
      expectAllFinite({ confidence: r.confidence }, `vix=${bad}`);
    }
  });

  it('treats a NaN input the same as a missing one', () => {
    expect(detectRegime(Number.NaN, Number.NaN, Number.NaN, Number.NaN).regime)
      .toBe(detectRegime(null, null, null, null).regime);
  });

  it('still classifies real fear correctly', () => {
    expect(detectRegime(38, 0.85, -0.2, -3).regime).toBe('bear_high_vol');
  });

  it('still classifies a calm bull correctly', () => {
    expect(detectRegime(12, 1.15, 1.2, 2).regime).toBe('bull_low_vol');
  });

  it('always reports a confidence in (0, 0.95]', () => {
    const inputs: Array<[number | null, number | null, number | null, number | null]> = [
      [12, 1.2, 1, 2], [38, 0.8, -0.5, -3], [null, null, null, null],
      [Number.NaN, 1, 1, 1], [20, Number.NaN, 0.5, 0],
    ];
    for (const args of inputs) {
      const r = detectRegime(...args);
      expect(Number.isFinite(r.confidence), JSON.stringify(args)).toBe(true);
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});

describe('fedWatchModel — must not emit a NaN implied rate', () => {
  it('produces a finite prediction for good input', () => {
    const r = fedWatchModel(5.0, 3.0, 4.0);
    expect(['hike', 'hold', 'cut']).toContain(r.prediction);
    expectAllFinite(r, 'good input');
  });

  it('predicts a hike when the Taylor rule is far above the funds rate', () => {
    expect(fedWatchModel(1.0, 6.0, 3.0).prediction).toBe('hike');
  });

  it('predicts a cut when the funds rate is far above the Taylor rule', () => {
    expect(fedWatchModel(8.0, 1.0, 6.0).prediction).toBe('cut');
  });

  it('never emits NaN for a non-finite indicator', () => {
    for (const bad of NON_FINITE) {
      expectAllFinite(fedWatchModel(bad, 3, 4), `fedFunds=${bad}`);
      expectAllFinite(fedWatchModel(5, bad, 4), `cpi=${bad}`);
      expectAllFinite(fedWatchModel(5, 3, bad), `unemployment=${bad}`);
    }
  });

  it('confidence stays within [0, 1]', () => {
    for (const [f, c, u] of [[5, 3, 4], [0, 10, 2], [10, 0, 10], [2.5, 2, 4.5]]) {
      const r = fedWatchModel(f, c, u);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('detectDriftRegime — must not emit a NaN Hurst or confidence', () => {
  const trending = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5);
  const noisy = Array.from({ length: 120 }, (_, i) => 100 + 5 * Math.sin(i * 1.9));

  it('returns finite fields for real price series', () => {
    expectAllFinite(detectDriftRegime(trending), 'trending');
    expectAllFinite(detectDriftRegime(noisy), 'noisy');
  });

  it('returns the neutral regime for too little data', () => {
    const r = detectDriftRegime([100, 101, 102]);
    expect(r.regime).toBe('random_walk');
    expect(r.confidence).toBe(0);
  });

  it('never emits NaN for degenerate series', () => {
    const cases: Array<[string, number[]]> = [
      ['flat', new Array(120).fill(100)],
      ['zeros', new Array(120).fill(0)],
      ['negatives', new Array(120).fill(-5)],
      ['with NaN', trending.map((v, i) => (i === 40 ? Number.NaN : v))],
      ['empty', []],
    ];
    for (const [label, prices] of cases) expectAllFinite(detectDriftRegime(prices), label);
  });

  it('confidence stays within [0, 1]', () => {
    for (const prices of [trending, noisy, new Array(120).fill(100)]) {
      const c = detectDriftRegime(prices).confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('testCointegration — must not emit a NaN p-value', () => {
  const a = Array.from({ length: 80 }, (_, i) => 100 + i * 0.2 + Math.sin(i) * 2);
  const b = Array.from({ length: 80 }, (_, i) => 50 + i * 0.1 + Math.sin(i) * 1);

  it('returns finite statistics for a real pair', () => {
    expectAllFinite(testCointegration(a, b), 'real pair');
  });

  it('reports no mean-reversion as null, not Infinity', () => {
    // Infinity survives in-process but JSON.stringify emits `null`, and
    // both /pairs and /scanner call .toFixed(1) on the field.
    const r = testCointegration([], []);
    expect(r.halfLife).toBeNull();
    expect(JSON.parse(JSON.stringify(r)).halfLife).toBeNull();
  });

  it('a returned half-life is always a finite positive number', () => {
    for (const [x, y] of [[a, b], [b, a], [a, a]] as const) {
      const h = testCointegration(x, y).halfLife;
      if (h !== null) {
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the p-value in [0.001, 1]', () => {
    const r = testCointegration(a, b);
    expect(r.pValue).toBeGreaterThanOrEqual(0.001);
    expect(r.pValue).toBeLessThanOrEqual(1);
  });

  it('never emits NaN for degenerate series', () => {
    const cases: Array<[string, number[], number[]]> = [
      ['flat vs flat', new Array(80).fill(100), new Array(80).fill(50)],
      ['flat vs real', new Array(80).fill(100), b],
      ['too short', [1, 2], [3, 4]],
      ['empty', [], []],
      ['with NaN', a.map((v, i) => (i === 10 ? Number.NaN : v)), b],
      ['mismatched lengths', a, b.slice(0, 40)],
    ];
    for (const [label, x, y] of cases) expectAllFinite(testCointegration(x, y), label);
  });
});
