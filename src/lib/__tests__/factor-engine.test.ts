/**
 * Factor exposure engine — bucket boundaries, weight normalisation and
 * degenerate holdings.
 *
 * Every exposure is a weighted sum of step functions, so the numbers are
 * exactly derivable by hand. These tests pin the bucket edges (which are
 * silent, magic-number policy) and the normalisation contract.
 */
import { describe, it, expect } from 'vitest';
import { analyzeFactorExposure } from '../factor-engine';

const H = (over: Record<string, unknown> = {}) => ({ symbol: 'X', weight: 1, ...over }) as Parameters<typeof analyzeFactorExposure>[0][number];

describe('analyzeFactorExposure — empty and degenerate input', () => {
  it('returns a zeroed analysis for no holdings', () => {
    const r = analyzeFactorExposure([]);
    expect(r.exposures).toEqual({ market: 0, size: 0, value: 0, momentum: 0, quality: 0, volatility: 0 });
    expect(r.riskDecomposition).toEqual({ systematic: 0, idiosyncratic: 100 });
    expect(r.interpretation).toMatch(/no holdings/i);
  });

  it('returns a zeroed analysis when total weight is effectively zero', () => {
    expect(analyzeFactorExposure([H({ weight: 0 }), H({ weight: 0 })]).interpretation)
      .toMatch(/zero weight/i);
  });

  it('does NOT produce a NaN analysis for a non-finite weight', () => {
    // `totalWeight < 0.01` is false when totalWeight is NaN, so the guard
    // was skipped and every exposure came out NaN.
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = analyzeFactorExposure([H({ weight }), H({ weight: 0.5 })]);
      for (const [k, v] of Object.entries(r.exposures)) {
        expect(Number.isFinite(v), `${k} for weight=${weight}`).toBe(true);
      }
      expect(Number.isFinite(r.rSquared)).toBe(true);
      expect(Number.isFinite(r.alpha)).toBe(true);
      expect(Number.isFinite(r.trackingError)).toBe(true);
    }
  });

  it('does not produce NaN when a factor input is non-finite', () => {
    const r = analyzeFactorExposure([
      H({ weight: 0.5, beta: Number.NaN, marketCap: Number.NaN, peRatio: Number.NaN, momentum1Y: Number.NaN, roe: Number.NaN, volatility: Number.NaN }),
      H({ weight: 0.5, beta: 1.2, marketCap: 300, peRatio: 30, momentum1Y: 20, roe: 25, volatility: 30 }),
    ]);
    for (const [k, v] of Object.entries(r.exposures)) {
      expect(Number.isFinite(v), k).toBe(true);
    }
  });
});

describe('analyzeFactorExposure — short positions', () => {
  it('keeps a short position instead of dropping it', () => {
    // /api/factors passes Alpaca's signed market_value straight through,
    // so a short book has negative weights. Filtering them out reports
    // the long leg as 100% of the portfolio — plausible and wrong.
    const longOnly = analyzeFactorExposure([H({ weight: 10_000, beta: 1.5 })]);
    const longShort = analyzeFactorExposure([
      H({ symbol: 'A', weight: 10_000, beta: 1.5 }),
      H({ symbol: 'B', weight: -4_000, beta: 2.0 }),
    ]);
    expect(longShort.exposures.market).not.toBe(longOnly.exposures.market);
    expect(Number.isFinite(longShort.exposures.market)).toBe(true);
  });

  it('nets a short against a long the way it did before the finiteness fix', () => {
    // net weight = 10000 - 4000 = 6000
    // market = (10000/6000)*1.0 + (-4000/6000)*2.0 = 1.6667 - 1.3333 = 0.33
    const r = analyzeFactorExposure([
      H({ symbol: 'A', weight: 10_000, beta: 1.0 }),
      H({ symbol: 'B', weight: -4_000, beta: 2.0 }),
    ]);
    expect(r.exposures.market).toBeCloseTo(0.33, 2);
  });
});

describe('analyzeFactorExposure — weight normalisation', () => {
  it('normalises weights, so absolute scale does not matter', () => {
    const a = analyzeFactorExposure([H({ weight: 1, beta: 1.5 }), H({ weight: 1, beta: 0.5 })]);
    const b = analyzeFactorExposure([H({ weight: 100, beta: 1.5 }), H({ weight: 100, beta: 0.5 })]);
    expect(a.exposures).toEqual(b.exposures);
  });

  it('market exposure is the weighted average beta', () => {
    expect(analyzeFactorExposure([
      H({ weight: 0.75, beta: 1.2 }), H({ weight: 0.25, beta: 0.4 }),
    ]).exposures.market).toBeCloseTo(1.0, 10);
  });

  it('defaults a missing beta to 1.0', () => {
    expect(analyzeFactorExposure([H({ weight: 1 })]).exposures.market).toBe(1);
  });
});

describe('analyzeFactorExposure — factor bucket boundaries', () => {
  const sizeFor = (marketCap: number) => analyzeFactorExposure([H({ marketCap })]).exposures.size;
  it('size buckets step at 2 / 10 / 50 / 200 billion', () => {
    expect(sizeFor(1)).toBe(0.8);     // micro
    expect(sizeFor(2)).toBe(0.4);     // boundary lands in the NEXT bucket
    expect(sizeFor(9.99)).toBe(0.4);  // small
    expect(sizeFor(10)).toBe(0);      // mid
    expect(sizeFor(50)).toBe(-0.3);   // large
    expect(sizeFor(200)).toBe(-0.6);  // mega
    expect(sizeFor(5000)).toBe(-0.6);
  });

  const valueFor = (peRatio: number) => analyzeFactorExposure([H({ peRatio })]).exposures.value;
  it('value buckets step at 10 / 15 / 25 / 40, and negative P/E contributes nothing', () => {
    expect(valueFor(5)).toBe(0.8);
    expect(valueFor(10)).toBe(0.4);
    expect(valueFor(15)).toBe(0);
    expect(valueFor(25)).toBe(-0.4);
    expect(valueFor(40)).toBe(-0.8);
    expect(valueFor(-3)).toBe(0);     // negative earnings: no tilt
  });

  it('momentum is 1-year return / 50, clamped to [-1, 1]', () => {
    expect(analyzeFactorExposure([H({ momentum1Y: 25 })]).exposures.momentum).toBeCloseTo(0.5, 10);
    expect(analyzeFactorExposure([H({ momentum1Y: 500 })]).exposures.momentum).toBe(1);
    expect(analyzeFactorExposure([H({ momentum1Y: -500 })]).exposures.momentum).toBe(-1);
    expect(analyzeFactorExposure([H({ momentum1Y: 0 })]).exposures.momentum).toBe(0);
  });

  const qualityFor = (roe: number) => analyzeFactorExposure([H({ roe })]).exposures.quality;
  it('quality buckets step at 10 / 20 / 30 ROE', () => {
    expect(qualityFor(35)).toBe(0.8);
    expect(qualityFor(30)).toBe(0.4);   // strictly greater-than
    expect(qualityFor(20)).toBe(0);
    expect(qualityFor(10)).toBe(-0.4);
    expect(qualityFor(-5)).toBe(-0.4);
  });

  const volFor = (volatility: number) => analyzeFactorExposure([H({ volatility })]).exposures.volatility;
  it('volatility buckets step at 15 / 25 / 40', () => {
    expect(volFor(10)).toBe(-0.6);
    expect(volFor(15)).toBe(0);
    expect(volFor(25)).toBe(0.4);
    expect(volFor(40)).toBe(0.8);
  });

  it('uses documented defaults when a field is missing', () => {
    // Defaults: cap 50 (mid->large edge), P/E 20 (blend), momentum 0,
    // ROE 15 (0 bucket), vol 25 (0.4 bucket).
    const r = analyzeFactorExposure([H({})]).exposures;
    expect(r).toEqual({ market: 1, size: -0.3, value: 0, momentum: 0, quality: 0, volatility: 0.4 });
  });
});

describe('analyzeFactorExposure — derived statistics', () => {
  it('bounds R-squared to [0.5, 0.98] and splits risk to exactly 100%', () => {
    const cases = [
      [H({ beta: 0.1 })],
      [H({ beta: 3, marketCap: 1, peRatio: 5, momentum1Y: 100, roe: 40, volatility: 60 })],
      [H({ weight: 0.5, beta: 1 }), H({ weight: 0.5, beta: 1.4 })],
    ];
    for (const holdings of cases) {
      const r = analyzeFactorExposure(holdings);
      expect(r.rSquared).toBeGreaterThanOrEqual(0.5);
      expect(r.rSquared).toBeLessThanOrEqual(0.98);
      expect(r.riskDecomposition.systematic + r.riskDecomposition.idiosyncratic).toBeCloseTo(100, 6);
      expect(r.trackingError).toBeGreaterThanOrEqual(0);
    }
  });

  it('tracking error falls as R-squared rises', () => {
    const low = analyzeFactorExposure([H({ beta: 0.1 })]);
    const high = analyzeFactorExposure([H({ beta: 3, marketCap: 1, peRatio: 5, momentum1Y: 100 })]);
    expect(high.rSquared).toBeGreaterThan(low.rSquared);
    expect(high.trackingError).toBeLessThan(low.trackingError);
  });
});

describe('analyzeFactorExposure — interpretation text', () => {
  it('calls out aggressive and defensive beta', () => {
    expect(analyzeFactorExposure([H({ beta: 1.5 })]).interpretation).toMatch(/aggressive market exposure/);
    expect(analyzeFactorExposure([H({ beta: 0.5 })]).interpretation).toMatch(/defensive positioning/);
  });

  it('calls out a small-cap, deep-value, high-vol book', () => {
    const s = analyzeFactorExposure([H({ marketCap: 1, peRatio: 5, volatility: 60 })]).interpretation;
    expect(s).toMatch(/small-cap tilt/);
    expect(s).toMatch(/value-oriented/);
    expect(s).toMatch(/high-volatility exposure/);
  });

  it('calls a neutral book balanced', () => {
    expect(analyzeFactorExposure([
      H({ beta: 1.0, marketCap: 30, peRatio: 20, momentum1Y: 0, roe: 15, volatility: 20 }),
    ]).interpretation).toMatch(/balanced/i);
  });

  it('never renders NaN in the interpretation', () => {
    for (const h of [H({ weight: Number.NaN }), H({ beta: Number.NaN }), H({})]) {
      expect(analyzeFactorExposure([h]).interpretation).not.toMatch(/NaN|undefined/);
    }
  });
});
