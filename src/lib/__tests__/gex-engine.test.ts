/**
 * Gamma-exposure engine — sign conventions, aggregation, level
 * detection and interpolation.
 *
 * Dealer gamma drives the "expect mean reversion" vs "expect trending"
 * call on the GEX page, so the sign convention is the whole product: a
 * flipped sign gives exactly the opposite trading advice.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateGEX, findGEXLevels, gexImpact,
  calculateVannaExposure, calculateCharmExposure,
  detectRegimeTransition, calculateGammaFlipLevel,
  type OptionsChainItem,
} from '../gex-engine';

function item(over: Partial<OptionsChainItem> & { strike: number }): OptionsChainItem {
  return {
    expiration: '2026-12-18',
    callOI: 0, putOI: 0, callGamma: 0, putGamma: 0, callVolume: 0, putVolume: 0,
    ...over,
  };
}

describe('calculateGEX — the arithmetic', () => {
  it('matches the documented formula OI x 100 x gamma x S^2 x 0.01', () => {
    const chain = [item({ strike: 100, callOI: 1000, callGamma: 0.05 })];
    // 1000 * 100 * 0.05 * 10,000 * 0.01 = 500,000
    expect(calculateGEX(chain, 100).totalGEX).toBeCloseTo(500_000, 6);
  });

  it('subtracts put gamma from call gamma', () => {
    const chain = [item({ strike: 100, callOI: 1000, callGamma: 0.05, putOI: 1000, putGamma: 0.05 })];
    expect(calculateGEX(chain, 100).totalGEX).toBeCloseTo(0, 9);
  });

  it('reports negative net GEX when puts dominate', () => {
    const chain = [item({ strike: 100, callOI: 100, callGamma: 0.05, putOI: 5000, putGamma: 0.05 })];
    expect(calculateGEX(chain, 100).totalGEX).toBeLessThan(0);
  });

  it('scales with the square of spot', () => {
    const chain = [item({ strike: 100, callOI: 1000, callGamma: 0.05 })];
    const a = calculateGEX(chain, 100).totalGEX;
    const b = calculateGEX(chain, 200).totalGEX;
    expect(b).toBeCloseTo(a * 4, 6);
  });

  it('aggregates the same strike across multiple expirations', () => {
    const chain = [
      item({ strike: 100, expiration: '2026-12-18', callOI: 1000, callGamma: 0.05 }),
      item({ strike: 100, expiration: '2027-01-15', callOI: 1000, callGamma: 0.05 }),
    ];
    const r = calculateGEX(chain, 100);
    expect(r.byStrike.size).toBe(1);
    expect(r.byStrike.get(100)).toBeCloseTo(1_000_000, 6);
  });

  it('totalGEX equals the sum over strikes and equals levels.netGEX', () => {
    const chain = [
      item({ strike: 95, putOI: 4000, putGamma: 0.04 }),
      item({ strike: 100, callOI: 3000, callGamma: 0.06 }),
      item({ strike: 105, callOI: 2000, callGamma: 0.03 }),
    ];
    const r = calculateGEX(chain, 100);
    let sum = 0;
    r.byStrike.forEach(v => { sum += v; });
    expect(r.totalGEX).toBeCloseTo(sum, 9);
    expect(r.levels.netGEX).toBeCloseTo(r.totalGEX, 9);
  });

  it('returns zeros for an empty chain rather than NaN', () => {
    const r = calculateGEX([], 100);
    expect(r.totalGEX).toBe(0);
    expect(r.byStrike.size).toBe(0);
    expect(Number.isFinite(r.levels.netGEX)).toBe(true);
  });

  it('ignores a non-finite gamma or open interest instead of poisoning net GEX', () => {
    // Alpaca's `snap?.greeks?.gamma ?? 0` only catches null/undefined —
    // a NaN reached the arithmetic and made every level NaN, which
    // JSON.stringify then rendered as null.
    const chain = [
      item({ strike: 100, callOI: 1000, callGamma: Number.NaN }),
      item({ strike: 105, callOI: 1000, callGamma: 0.05 }),
    ];
    const r = calculateGEX(chain, 100);
    expect(Number.isFinite(r.totalGEX)).toBe(true);
    expect(r.totalGEX).toBeCloseTo(500_000, 6);
  });
});

describe('findGEXLevels', () => {
  const chain = [
    item({ strike: 90, putOI: 8000, putGamma: 0.05 }),
    item({ strike: 95, putOI: 3000, putGamma: 0.04 }),
    item({ strike: 100, callOI: 2000, callGamma: 0.03, putOI: 1000, putGamma: 0.01 }),
    item({ strike: 105, callOI: 9000, callGamma: 0.06 }),
    item({ strike: 110, callOI: 4000, callGamma: 0.02 }),
  ];
  const levels = calculateGEX(chain, 100).levels;

  it('puts the call wall at the largest positive GEX strike', () => {
    expect(levels.callWall).toBe(105);
  });

  it('puts the put wall at the most negative GEX strike', () => {
    expect(levels.putWall).toBe(90);
  });

  it('puts the high-volume level at the largest total open interest', () => {
    expect(levels.hvl).toBe(105); // 9000 calls
  });

  it('finds the gamma flip at the first sign change', () => {
    // Strikes ascending: 90(-), 95(-), 100(+), ... first flip is 95 -> 100.
    expect([95, 100]).toContain(levels.gammaFlip);
  });

  it('ranks pin strikes by absolute GEX, largest first', () => {
    expect(levels.pinStrikes).toHaveLength(3);
    const byStrike = calculateGEX(chain, 100).byStrike;
    const mags = levels.pinStrikes.map(s => Math.abs(byStrike.get(s)!));
    for (let i = 1; i < mags.length; i++) expect(mags[i]).toBeLessThanOrEqual(mags[i - 1]);
  });

  it('labels a net-positive book "positive" and a net-negative book "negative"', () => {
    expect(calculateGEX([item({ strike: 100, callOI: 1000, callGamma: 0.05 })], 100).levels.regime)
      .toBe('positive');
    expect(calculateGEX([item({ strike: 100, putOI: 1000, putGamma: 0.05 })], 100).levels.regime)
      .toBe('negative');
  });

  it('treats exactly zero net GEX as negative (documented tie-break)', () => {
    const flat = [item({ strike: 100, callOI: 1000, callGamma: 0.05, putOI: 1000, putGamma: 0.05 })];
    expect(calculateGEX(flat, 100).levels.regime).toBe('negative');
  });

  it('reports zeroed levels for an empty book without crashing', () => {
    const l = findGEXLevels(new Map(), []);
    expect(l).toMatchObject({ putWall: 0, callWall: 0, hvl: 0, gammaFlip: 0, netGEX: 0, pinStrikes: [] });
  });
});

describe('gexImpact — dealer-hedging narrative', () => {
  it('describes positive gamma as vol-suppressing and mean-reverting', () => {
    const s = gexImpact(1e9, 100);
    expect(s).toMatch(/positive gamma/i);
    expect(s).toMatch(/mean-reversion|dampens/i);
  });

  it('describes negative gamma as vol-amplifying and trending', () => {
    const s = gexImpact(-1e9, 100);
    expect(s).toMatch(/negative gamma/i);
    expect(s).toMatch(/amplif|trending/i);
  });

  it('distinguishes strong from moderate at |netGEX| / spot^2 = 1', () => {
    expect(gexImpact(2 * 100 * 100, 100)).toMatch(/^Strong positive/);
    expect(gexImpact(0.5 * 100 * 100, 100)).toMatch(/^Moderate positive/);
    expect(gexImpact(-2 * 100 * 100, 100)).toMatch(/^Strong negative/);
    expect(gexImpact(-0.5 * 100 * 100, 100)).toMatch(/^Moderate negative/);
  });

  it('never emits NaN wording for a zero spot', () => {
    expect(gexImpact(1000, 0)).not.toMatch(/NaN|undefined/);
  });
});

describe('vanna and charm', () => {
  const chain = [
    item({ strike: 90, callOI: 1000, callGamma: 0.04 }),
    item({ strike: 110, callOI: 1000, callGamma: 0.04 }),
  ];

  it('returns 0 for an empty chain or a zero spot', () => {
    expect(calculateVannaExposure([], 100)).toBe(0);
    expect(calculateVannaExposure(chain, 0)).toBe(0);
    expect(calculateCharmExposure([], 100)).toBe(0);
    expect(calculateCharmExposure(chain, 0)).toBe(0);
  });

  it('vanna is zero at the money (log-moneyness is zero)', () => {
    expect(calculateVannaExposure([item({ strike: 100, callOI: 1000, callGamma: 0.04 })], 100))
      .toBeCloseTo(0, 9);
  });

  it('vanna flips sign with moneyness', () => {
    const below = calculateVannaExposure([item({ strike: 110, callOI: 1000, callGamma: 0.04 })], 100);
    const above = calculateVannaExposure([item({ strike: 90, callOI: 1000, callGamma: 0.04 })], 100);
    expect(Math.sign(below)).toBe(-Math.sign(above));
  });

  it('charm grows as expiry approaches', () => {
    const soon = new Date(Date.now() + 2 * 86400_000).toISOString().split('T')[0];
    const later = new Date(Date.now() + 200 * 86400_000).toISOString().split('T')[0];
    const near = calculateCharmExposure([item({ strike: 100, expiration: soon, callOI: 1000, callGamma: 0.04 })], 100);
    const far = calculateCharmExposure([item({ strike: 100, expiration: later, callOI: 1000, callGamma: 0.04 })], 100);
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far));
  });

  it('never emits NaN for an already-expired contract', () => {
    const v = calculateCharmExposure([item({ strike: 100, expiration: '2020-01-17', callOI: 1000, callGamma: 0.04 })], 100);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('detectRegimeTransition', () => {
  it('flags a flip into negative gamma', () => {
    expect(detectRegimeTransition(-100, 100)).toBe('flip_negative');
    expect(detectRegimeTransition(-1, 0)).toBe('flip_negative');
  });

  it('flags a flip into positive gamma', () => {
    expect(detectRegimeTransition(100, -100)).toBe('flip_positive');
    expect(detectRegimeTransition(0, -1)).toBe('flip_positive');
  });

  it('reports nothing when the sign is unchanged', () => {
    expect(detectRegimeTransition(100, 200)).toBeNull();
    expect(detectRegimeTransition(-100, -200)).toBeNull();
    expect(detectRegimeTransition(0, 5)).toBeNull();
  });
});

describe('calculateGammaFlipLevel — linear interpolation of the zero crossing', () => {
  it('lands exactly midway for a symmetric crossing', () => {
    expect(calculateGammaFlipLevel([
      { strike: 90, gex: 100 }, { strike: 110, gex: -100 },
    ])).toBeCloseTo(100, 9);
  });

  it('weights the crossing toward the smaller-magnitude side', () => {
    // +150 at 90, -50 at 110 -> root at 90 + 20*(150/200) = 105
    expect(calculateGammaFlipLevel([
      { strike: 90, gex: 150 }, { strike: 110, gex: -50 },
    ])).toBeCloseTo(105, 9);
  });

  it('is order-independent (it sorts by strike first)', () => {
    expect(calculateGammaFlipLevel([
      { strike: 110, gex: -50 }, { strike: 90, gex: 150 },
    ])).toBeCloseTo(105, 9);
  });

  it('returns the crossing strike itself when one side is exactly zero', () => {
    expect(calculateGammaFlipLevel([{ strike: 90, gex: 0 }, { strike: 110, gex: 5 }]))
      .toBeCloseTo(90, 9);
  });

  it('returns null when there is no sign change', () => {
    expect(calculateGammaFlipLevel([{ strike: 90, gex: 5 }, { strike: 110, gex: 10 }])).toBeNull();
    expect(calculateGammaFlipLevel([{ strike: 90, gex: -5 }, { strike: 110, gex: -10 }])).toBeNull();
  });

  it('returns null for fewer than two points', () => {
    expect(calculateGammaFlipLevel([])).toBeNull();
    expect(calculateGammaFlipLevel([{ strike: 100, gex: 1 }])).toBeNull();
  });

  it('always returns a level between the two bracketing strikes', () => {
    for (const [a, b] of [[10, -1], [1, -10], [3, -3], [0.5, -100]]) {
      const lvl = calculateGammaFlipLevel([{ strike: 95, gex: a }, { strike: 105, gex: b }])!;
      expect(lvl).toBeGreaterThanOrEqual(95);
      expect(lvl).toBeLessThanOrEqual(105);
    }
  });

  it('never returns NaN when both sides are zero-adjacent', () => {
    const lvl = calculateGammaFlipLevel([{ strike: 95, gex: 0 }, { strike: 105, gex: 0 }]);
    expect(lvl === null || Number.isFinite(lvl)).toBe(true);
  });
});
