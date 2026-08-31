/**
 * options/greeks — cross-checked against black-scholes.ts across a grid,
 * plus payoff algebra.
 *
 * The repo carried TWO independent Black-Scholes implementations. They
 * agreed at the reference point, but "two implementations that happen to
 * agree today" is a latent divergence: a fix applied to one silently
 * leaves the other wrong. These tests pin the agreement across a full
 * moneyness/expiry/vol grid.
 */
import { describe, it, expect } from 'vitest';
import {
  blackScholesPrice, calculateGreeks, solveIV, optionPayoff, multiLegPayoff, multiLegCurrentValue,
} from '../greeks';
import { bsPrice, bsDelta, bsGamma, bsTheta, bsVega, bsRho, impliedVolatility } from '../../black-scholes';

const GRID: Array<[number, number, number, number, number]> = [];
for (const S of [70, 90, 100, 110, 140]) {
  for (const K of [80, 100, 120]) {
    for (const T of [0.08, 0.25, 1, 2]) {
      for (const sigma of [0.1, 0.25, 0.6]) GRID.push([S, K, T, 0.05, sigma]);
    }
  }
}

describe('the two Black-Scholes implementations must agree exactly', () => {
  it('prices are identical across the grid', () => {
    for (const [S, K, T, r, sigma] of GRID) {
      for (const type of ['call', 'put'] as const) {
        expect(blackScholesPrice(S, K, T, r, sigma, type)).toBe(bsPrice(S, K, T, r, sigma, type));
      }
    }
  });

  it('every greek is identical across the grid', () => {
    for (const [S, K, T, r, sigma] of GRID) {
      for (const type of ['call', 'put'] as const) {
        const g = calculateGreeks(S, K, T, r, sigma, type);
        expect(g.price).toBe(bsPrice(S, K, T, r, sigma, type));
        expect(g.delta).toBe(bsDelta(S, K, T, r, sigma, type));
        expect(g.gamma).toBe(bsGamma(S, K, T, r, sigma));
        expect(g.vega).toBe(bsVega(S, K, T, r, sigma));
        expect(g.theta).toBe(bsTheta(S, K, T, r, sigma, type));
        expect(g.rho).toBe(bsRho(S, K, T, r, sigma, type));
      }
    }
  });

  it('solveIV agrees with impliedVolatility (note the different argument order)', () => {
    for (const [S, K, T, r, sigma] of GRID) {
      for (const type of ['call', 'put'] as const) {
        const price = bsPrice(S, K, T, r, sigma, type);
        expect(solveIV(S, K, T, r, price, type)).toBe(impliedVolatility(price, S, K, T, r, type));
      }
    }
  });

  it('agrees at the published reference point', () => {
    expect(blackScholesPrice(100, 100, 1, 0.05, 0.2, 'call')).toBeCloseTo(10.450584, 4);
    const g = calculateGreeks(100, 100, 1, 0.05, 0.2, 'call');
    expect(g.delta).toBeCloseTo(0.636831, 5);
    expect(g.gamma).toBeCloseTo(0.018762, 5);
    expect(g.vega).toBeCloseTo(0.375240, 5);
    expect(g.rho).toBeCloseTo(0.532325, 5);
  });
});

describe('calculateGreeks — contract', () => {
  it('reports theta per calendar day, not per year', () => {
    const g = calculateGreeks(100, 100, 1, 0.05, 0.2, 'call');
    // Annual theta at this point is about -6.4; daily is about -0.0176.
    expect(g.theta).toBeLessThan(0);
    expect(Math.abs(g.theta)).toBeLessThan(0.1);
  });

  it('returns intrinsic value and flat greeks at expiry', () => {
    expect(calculateGreeks(110, 100, 0, 0.05, 0.2, 'call')).toEqual({
      price: 10, delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0,
    });
    expect(calculateGreeks(90, 100, 0, 0.05, 0.2, 'put')).toEqual({
      price: 10, delta: -1, gamma: 0, theta: 0, vega: 0, rho: 0,
    });
    expect(calculateGreeks(100, 100, 0, 0.05, 0.2, 'call')).toEqual({
      price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
    });
  });

  it('emits no NaN for degenerate inputs — gamma used to serialise as null', () => {
    const degenerate: Array<[number, number, number, number, number]> = [
      [100, 100, 1, 0.05, 0],   // zero vol
      [0, 100, 1, 0.05, 0.2],   // worthless stock
      [100, 100, 1e-9, 0.05, 0.2],
      [100, 100, 1, -0.03, 0.2],
      [10, 1000, 0.02, 0.05, 0.1],
    ];
    for (const args of degenerate) {
      for (const type of ['call', 'put'] as const) {
        const g = calculateGreeks(...args, type);
        for (const [k, v] of Object.entries(g)) {
          expect(Number.isFinite(v), `${k} for ${JSON.stringify(args)} ${type}`).toBe(true);
        }
      }
    }
  });
});

describe('optionPayoff — payoff algebra at expiration', () => {
  it('prices a long call correctly on both sides of the strike', () => {
    // 1 contract, $100 strike, $5 premium
    expect(optionPayoff('call', 100, 5, 1, true, 120)).toBe((20 - 5) * 100);
    expect(optionPayoff('call', 100, 5, 1, true, 100)).toBe(-5 * 100);
    expect(optionPayoff('call', 100, 5, 1, true, 80)).toBe(-5 * 100);
  });

  it('prices a long put correctly on both sides of the strike', () => {
    expect(optionPayoff('put', 100, 5, 1, true, 80)).toBe((20 - 5) * 100);
    expect(optionPayoff('put', 100, 5, 1, true, 120)).toBe(-5 * 100);
  });

  it('a short position is the exact mirror of the long', () => {
    for (const price of [60, 90, 100, 110, 200]) {
      for (const type of ['call', 'put'] as const) {
        expect(optionPayoff(type, 100, 5, 1, false, price))
          .toBe(-optionPayoff(type, 100, 5, 1, true, price));
      }
    }
  });

  it('caps a short call loss at nothing and a long call loss at the premium', () => {
    expect(optionPayoff('call', 100, 5, 1, true, 0)).toBe(-500);
    expect(optionPayoff('call', 100, 5, 2, true, 0)).toBe(-1000);
  });

  it('breaks even at strike + premium for a long call', () => {
    expect(optionPayoff('call', 100, 5, 1, true, 105)).toBe(0);
    expect(optionPayoff('put', 100, 5, 1, true, 95)).toBe(0);
  });

  it('scales linearly with quantity and uses the 100x contract multiplier', () => {
    expect(optionPayoff('call', 100, 5, 3, true, 120)).toBe(3 * (20 - 5) * 100);
  });
});

describe('multiLegPayoff', () => {
  const bullCallSpread = [
    { type: 'call' as const, strike: 100, premium: 6, quantity: 1, isLong: true },
    { type: 'call' as const, strike: 110, premium: 2, quantity: 1, isLong: false },
  ];

  it('samples the full price range inclusively', () => {
    const pts = multiLegPayoff(bullCallSpread, 100, 0.3, 100);
    expect(pts).toHaveLength(101);
    expect(pts[0].price).toBeCloseTo(70, 6);
    expect(pts[pts.length - 1].price).toBeCloseTo(130, 6);
  });

  it('is monotonically increasing in price for a bull call spread', () => {
    const pts = multiLegPayoff(bullCallSpread, 100, 0.3, 100);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].pnl).toBeGreaterThanOrEqual(pts[i - 1].pnl - 1e-9);
    }
  });

  it('caps a debit spread at (width - net debit) and floors it at the net debit', () => {
    const pts = multiLegPayoff(bullCallSpread, 100, 0.3, 100);
    const pnls = pts.map(p => p.pnl);
    // Net debit = 6 - 2 = 4 -> max loss $400, max profit (10 - 4) * 100 = $600
    expect(Math.min(...pnls)).toBeCloseTo(-400, 6);
    expect(Math.max(...pnls)).toBeCloseTo(600, 6);
  });

  it('caps a long straddle loss at the total premium at the strike', () => {
    const straddle = [
      { type: 'call' as const, strike: 100, premium: 5, quantity: 1, isLong: true },
      { type: 'put' as const, strike: 100, premium: 5, quantity: 1, isLong: true },
    ];
    const pts = multiLegPayoff(straddle, 100, 0.3, 100);
    expect(Math.min(...pts.map(p => p.pnl))).toBeCloseTo(-1000, 6);
    // Profitable at both tails.
    expect(pts[0].pnl).toBeGreaterThan(0);
    expect(pts[pts.length - 1].pnl).toBeGreaterThan(0);
  });

  it('produces no NaN and honours a custom point count', () => {
    const pts = multiLegPayoff(bullCallSpread, 100, 0.5, 20);
    expect(pts).toHaveLength(21);
    for (const p of pts) {
      expect(Number.isFinite(p.price)).toBe(true);
      expect(Number.isFinite(p.pnl)).toBe(true);
    }
  });

  it('returns a flat zero line for no legs', () => {
    const pts = multiLegPayoff([], 100, 0.3, 10);
    expect(pts).toHaveLength(11);
    for (const p of pts) expect(p.pnl).toBe(0);
  });
});

describe('multiLegCurrentValue', () => {
  const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  it('values a long call above its expiration payoff (time value is positive)', () => {
    const leg = [{
      type: 'call' as const, strike: 100, premium: 6, quantity: 1, isLong: true, expiration: farFuture,
    }];
    const now = multiLegCurrentValue(leg, 100, 0.05, 0.25, 0.3, 20);
    const atExpiry = multiLegPayoff(
      [{ type: 'call', strike: 100, premium: 6, quantity: 1, isLong: true }], 100, 0.3, 20);
    for (let i = 0; i < now.length; i++) {
      expect(now[i].pnl).toBeGreaterThanOrEqual(atExpiry[i].pnl - 1e-6);
    }
  });

  it('samples the same inclusive price range as multiLegPayoff', () => {
    const pts = multiLegCurrentValue([{
      type: 'call', strike: 100, premium: 6, quantity: 1, isLong: true, expiration: farFuture,
    }], 100, 0.05, 0.25, 0.3, 100);
    expect(pts).toHaveLength(101);
    expect(pts[0].price).toBeCloseTo(70, 6);
    expect(pts[pts.length - 1].price).toBeCloseTo(130, 6);
  });

  it('emits no NaN for an already-expired leg', () => {
    const pts = multiLegCurrentValue([{
      type: 'call', strike: 100, premium: 6, quantity: 1, isLong: true, expiration: '2020-01-17',
    }], 100, 0.05, 0.25, 0.3, 10);
    for (const p of pts) expect(Number.isFinite(p.pnl)).toBe(true);
  });
});
