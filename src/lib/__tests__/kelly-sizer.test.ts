/**
 * Kelly Criterion sizer — adversarial + known-answer coverage.
 *
 * The Kelly sizer feeds three consumers that can move real money:
 *   - src/app/api/autopilot/route.ts  (autonomous trading)
 *   - src/lib/trade-guard-engine.ts   (the guard that blocks bad trades)
 *   - src/lib/signal-scorer.ts
 *
 * Its inputs (winRate / avgWin / avgLoss) are derived from broker and
 * historical API data, so malformed upstream fields are a realistic
 * trigger — not a theoretical one. These tests exist because every
 * `<`/`<=` comparison against NaN is false, which routed garbage input
 * to the final `else` branch: "Strong edge detected".
 */
import { describe, it, expect } from 'vitest';
import {
  calculateKelly,
  continuousKelly,
  optionsKelly,
  MAX_KELLY_FRACTION,
  INSUFFICIENT_DATA_RECOMMENDATION,
} from '../kelly-sizer';

/** Textbook Kelly: f* = (bp - q) / b, b = avgWin/avgLoss. */
function referenceKelly(winRate: number, avgWin: number, avgLoss: number): number {
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  return Math.max(0, (b * p - q) / b);
}

describe('calculateKelly — known answers', () => {
  it('matches the textbook formula for a coin flip with 2:1 payoff', () => {
    // b = 2, p = 0.5, q = 0.5 -> (2*0.5 - 0.5)/2 = 0.25
    const r = calculateKelly({ winRate: 0.5, avgWin: 0.2, avgLoss: 0.1 }, 100_000);
    expect(r.fullKelly).toBeCloseTo(0.25, 12);
    expect(r.fullKelly).toBeCloseTo(referenceKelly(0.5, 0.2, 0.1), 12);
  });

  it('matches the textbook formula for a 60% win rate at even money', () => {
    // b = 1, p = 0.6 -> (0.6 - 0.4)/1 = 0.20
    const r = calculateKelly({ winRate: 0.6, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.fullKelly).toBeCloseTo(0.2, 12);
  });

  it('returns zero for a negative-edge setup and says do not trade', () => {
    // b = 1, p = 0.4 -> (0.4 - 0.6)/1 = -0.2 -> floored at 0
    const r = calculateKelly({ winRate: 0.4, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.fullKelly).toBe(0);
    expect(r.halfKelly).toBe(0);
    expect(r.dollarsAtRisk).toBe(0);
    expect(r.recommendation).toMatch(/do not take this trade/i);
  });

  it('is exactly zero at the break-even edge (bp === q)', () => {
    // b = 1, p = 0.5 -> 0
    const r = calculateKelly({ winRate: 0.5, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.fullKelly).toBe(0);
    expect(r.recommendation).toMatch(/do not take this trade/i);
  });
});

describe('calculateKelly — the field names must not lie', () => {
  it('fullKelly is the UNCAPPED Kelly fraction', () => {
    // b = 1, p = 0.9 -> 0.8, far above the 25% safety cap.
    const r = calculateKelly({ winRate: 0.9, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.fullKelly).toBeCloseTo(0.8, 12);
  });

  it('cappedKelly is what the half/quarter ladder derives from', () => {
    const r = calculateKelly({ winRate: 0.9, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.cappedKelly).toBe(MAX_KELLY_FRACTION);
    expect(r.halfKelly).toBeCloseTo(MAX_KELLY_FRACTION / 2, 12);
    expect(r.quarterKelly).toBeCloseTo(MAX_KELLY_FRACTION / 4, 12);
  });

  it('the recommendation branch and the reported fullKelly agree', () => {
    // Anything the text calls a "strong edge" must read >= 0.15 on the
    // field the caller inspects. Previously the text branched on the
    // uncapped local while the field returned the capped value.
    const r = calculateKelly({ winRate: 0.9, avgWin: 0.05, avgLoss: 0.05 });
    expect(r.recommendation).toMatch(/strong edge/i);
    expect(r.fullKelly).toBeGreaterThanOrEqual(0.15);
  });

  it('keeps the sizing ladder monotone: quarter <= half <= capped <= full', () => {
    for (const winRate of [0.05, 0.3, 0.5, 0.55, 0.7, 0.95]) {
      const r = calculateKelly({ winRate, avgWin: 0.08, avgLoss: 0.05 });
      expect(r.quarterKelly).toBeLessThanOrEqual(r.halfKelly);
      expect(r.halfKelly).toBeLessThanOrEqual(r.cappedKelly);
      expect(r.cappedKelly).toBeLessThanOrEqual(r.fullKelly);
    }
  });

  it('never recommends more than the safety cap', () => {
    const r = calculateKelly({ winRate: 0.99, avgWin: 1, avgLoss: 0.01 });
    expect(r.cappedKelly).toBeLessThanOrEqual(MAX_KELLY_FRACTION);
    expect(r.halfKelly).toBeLessThanOrEqual(MAX_KELLY_FRACTION / 2);
  });
});

describe('calculateKelly — monotonicity', () => {
  it('Kelly rises with win rate, all else equal', () => {
    let prev = -1;
    for (const winRate of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const f = calculateKelly({ winRate, avgWin: 0.06, avgLoss: 0.05 }).fullKelly;
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('Kelly rises as the payoff ratio improves, all else equal', () => {
    let prev = -1;
    for (const avgWin of [0.05, 0.08, 0.12, 0.2, 0.4]) {
      const f = calculateKelly({ winRate: 0.55, avgWin, avgLoss: 0.05 }).fullKelly;
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('dollarsAtRisk scales linearly with portfolio size', () => {
    const a = calculateKelly({ winRate: 0.6, avgWin: 0.1, avgLoss: 0.05 }, 100_000);
    const b = calculateKelly({ winRate: 0.6, avgWin: 0.1, avgLoss: 0.05 }, 200_000);
    expect(b.dollarsAtRisk).toBeCloseTo(a.dollarsAtRisk * 2, 9);
  });
});

describe('calculateKelly — FAILS CLOSED on non-finite input', () => {
  // Every one of these previously produced
  //   "Strong edge detected. Half-Kelly (NaN%) to manage tail risk."
  // because NaN <= 0, NaN < 0.05 and NaN < 0.15 are all false.
  const nonFinite: Array<[string, number]> = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  for (const [label, bad] of nonFinite) {
    it(`rejects winRate = ${label}`, () => {
      const r = calculateKelly({ winRate: bad, avgWin: 0.08, avgLoss: 0.05 });
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.fullKelly).toBe(0);
      expect(r.halfKelly).toBe(0);
      expect(r.dollarsAtRisk).toBe(0);
      expect(r.maxLoss).toBe(0);
      expect(r.recommendation).not.toMatch(/strong edge/i);
    });

    it(`rejects avgWin = ${label}`, () => {
      const r = calculateKelly({ winRate: 0.6, avgWin: bad, avgLoss: 0.05 });
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.fullKelly).toBe(0);
    });

    it(`rejects avgLoss = ${label}`, () => {
      const r = calculateKelly({ winRate: 0.6, avgWin: 0.08, avgLoss: bad });
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.fullKelly).toBe(0);
    });

    it(`rejects portfolioSize = ${label}`, () => {
      const r = calculateKelly({ winRate: 0.6, avgWin: 0.08, avgLoss: 0.05 }, bad);
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.dollarsAtRisk).toBe(0);
    });
  }

  it('every numeric field is finite for every non-finite input combination', () => {
    const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.6];
    for (const winRate of values) {
      for (const avgWin of values) {
        for (const avgLoss of values) {
          const r = calculateKelly({ winRate, avgWin, avgLoss }, 100_000);
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === 'number') {
              expect(Number.isFinite(v), `${k} for (${winRate},${avgWin},${avgLoss})`).toBe(true);
            }
          }
          expect(r.recommendation).not.toMatch(/NaN|Infinity/);
        }
      }
    }
  });

  it('rejects a winRate outside [0, 1] instead of silently clamping it', () => {
    // A caller passing a PERCENT (55) instead of a fraction (0.55) is
    // malformed data, not a 99% win rate.
    for (const winRate of [-0.5, 1.5, 55, 100]) {
      const r = calculateKelly({ winRate, avgWin: 0.08, avgLoss: 0.05 });
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.fullKelly).toBe(0);
    }
  });

  it('rejects avgLoss <= 0 rather than defaulting the odds to 1:1', () => {
    for (const avgLoss of [0, -0.05]) {
      const r = calculateKelly({ winRate: 0.6, avgWin: 0.08, avgLoss });
      expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
      expect(r.fullKelly).toBe(0);
    }
  });

  it('rejects a negative avgWin', () => {
    const r = calculateKelly({ winRate: 0.6, avgWin: -0.08, avgLoss: 0.05 });
    expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
    expect(r.fullKelly).toBe(0);
  });

  it('rejects a negative portfolio size', () => {
    const r = calculateKelly({ winRate: 0.6, avgWin: 0.08, avgLoss: 0.05 }, -100_000);
    expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
    expect(r.dollarsAtRisk).toBe(0);
  });

  it('accepts a zero portfolio size and sizes to zero dollars', () => {
    // Zero equity is a legitimate state (fresh account), not malformed data.
    const r = calculateKelly({ winRate: 0.6, avgWin: 0.1, avgLoss: 0.05 }, 0);
    expect(r.recommendation).not.toBe(INSUFFICIENT_DATA_RECOMMENDATION);
    expect(r.fullKelly).toBeGreaterThan(0);
    expect(r.dollarsAtRisk).toBe(0);
  });

  it('renders no NaN or Infinity in the recommendation text, ever', () => {
    const r = calculateKelly({ winRate: Number.NaN, avgWin: Number.NaN, avgLoss: Number.NaN });
    expect(r.recommendation).not.toContain('NaN');
    expect(r.recommendation).not.toContain('Infinity');
  });
});

describe('optionsKelly', () => {
  it('derives odds from premium and max loss', () => {
    // b = 100/400 = 0.25, p = 0.7, q = 0.3 -> (0.25*0.7 - 0.3)/0.25 = -0.5 -> 0
    const r = optionsKelly(100, 400, 0.7);
    expect(r.fullKelly).toBe(0);
    expect(r.recommendation).toMatch(/do not take this trade/i);
  });

  it('sizes a genuinely favourable options setup', () => {
    // b = 300/100 = 3, p = 0.5 -> (3*0.5 - 0.5)/3 = 0.3333
    const r = optionsKelly(300, 100, 0.5);
    expect(r.fullKelly).toBeCloseTo(1 / 3, 10);
    expect(r.cappedKelly).toBe(MAX_KELLY_FRACTION);
  });

  it('fails closed when maxLoss is zero', () => {
    const r = optionsKelly(100, 0, 0.7);
    expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
    expect(r.fullKelly).toBe(0);
  });

  it('fails closed on a NaN win rate', () => {
    const r = optionsKelly(100, 400, Number.NaN);
    expect(r.recommendation).toBe(INSUFFICIENT_DATA_RECOMMENDATION);
  });
});

describe('continuousKelly', () => {
  it('matches f* = (mu - r) / sigma^2', () => {
    // (0.15 - 0.05) / 0.2^2 = 2.5 -> clamped to 1
    expect(continuousKelly(0.15, 0.2, 0.05)).toBe(1);
    // (0.07 - 0.05) / 0.4^2 = 0.125
    expect(continuousKelly(0.07, 0.4, 0.05)).toBeCloseTo(0.125, 12);
  });

  it('floors a negative edge at zero', () => {
    expect(continuousKelly(0.01, 0.2, 0.05)).toBe(0);
  });

  it('returns 0 for non-positive volatility', () => {
    expect(continuousKelly(0.15, 0, 0.05)).toBe(0);
    expect(continuousKelly(0.15, -0.2, 0.05)).toBe(0);
  });

  it('fails closed on non-finite input instead of returning NaN', () => {
    expect(continuousKelly(Number.NaN, 0.2, 0.05)).toBe(0);
    expect(continuousKelly(0.15, Number.NaN, 0.05)).toBe(0);
    expect(continuousKelly(0.15, 0.2, Number.NaN)).toBe(0);
    expect(continuousKelly(Number.POSITIVE_INFINITY, 0.2, 0.05)).toBe(0);
  });

  it('is bounded to [0, 1]', () => {
    for (const mu of [-1, 0, 0.05, 0.5, 5]) {
      for (const vol of [0.01, 0.1, 0.5, 2]) {
        const k = continuousKelly(mu, vol, 0.05);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(1);
      }
    }
  });
});
