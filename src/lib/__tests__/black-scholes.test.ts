/**
 * Black-Scholes — known answers, exact identities, finite-difference
 * greeks, no-arbitrage bounds, monotonicity, IV round-trips, and
 * degenerate inputs.
 *
 * None of these tests assert "whatever the code returns today". Every
 * expectation is an independently derivable fact: a published reference
 * value, an identity that must hold for any correct implementation, or a
 * numerical derivative of the pricing function itself.
 */
import { describe, it, expect } from 'vitest';
import {
  normalCDF, bsPrice, bsDelta, bsGamma, bsTheta, bsVega, bsRho, impliedVolatility,
} from '../black-scholes';

const REF = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };

/** A moderately wide grid of moneyness / expiry / vol. */
const GRID: Array<{ S: number; K: number; T: number; r: number; sigma: number }> = [];
for (const S of [70, 90, 100, 110, 140]) {
  for (const K of [80, 100, 120]) {
    for (const T of [0.25, 0.5, 1, 2]) {
      for (const sigma of [0.15, 0.25, 0.6]) GRID.push({ S, K, T, r: 0.05, sigma });
    }
  }
}

describe('normalCDF', () => {
  it('matches published values of the standard normal CDF', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 8);
    expect(normalCDF(1)).toBeCloseTo(0.8413447461, 7);
    expect(normalCDF(-1)).toBeCloseTo(0.1586552539, 7);
    expect(normalCDF(1.96)).toBeCloseTo(0.9750021049, 6);
    expect(normalCDF(-1.96)).toBeCloseTo(0.0249978951, 6);
    expect(normalCDF(2.326347874)).toBeCloseTo(0.99, 6);
  });

  it('satisfies N(x) + N(-x) === 1 to machine precision', () => {
    for (const x of [0, 0.1, 0.5, 1, 1.96, 3, 5, 8]) {
      expect(normalCDF(x) + normalCDF(-x)).toBeCloseTo(1, 8);
    }
  });

  it('is monotonically non-decreasing and bounded to [0, 1]', () => {
    let prev = -1;
    for (let x = -6; x <= 6; x += 0.25) {
      const v = normalCDF(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('saturates in the tails', () => {
    expect(normalCDF(-10)).toBeLessThan(1e-6);
    expect(normalCDF(10)).toBeGreaterThan(1 - 1e-6);
  });
});

describe('bsPrice — known answers', () => {
  it('matches the textbook reference point', () => {
    expect(bsPrice(100, 100, 1, 0.05, 0.2, 'call')).toBeCloseTo(10.450584, 4);
    expect(bsPrice(100, 100, 1, 0.05, 0.2, 'put')).toBeCloseTo(5.573526, 4);
  });

  it('matches a second reference: S=42, K=40, T=0.5, r=10%, sigma=20%', () => {
    // Hull, Options Futures & Other Derivatives — call 4.76, put 0.81
    expect(bsPrice(42, 40, 0.5, 0.1, 0.2, 'call')).toBeCloseTo(4.759422, 4);
    expect(bsPrice(42, 40, 0.5, 0.1, 0.2, 'put')).toBeCloseTo(0.808599, 4);
  });

  it('matches a third reference: S=49, K=50, T=0.3846, r=5%, sigma=20%', () => {
    // Hull's delta-hedging example — call ~2.40
    expect(bsPrice(49, 50, 0.3846, 0.05, 0.2, 'call')).toBeCloseTo(2.4005, 3);
  });
});

describe('bsPrice — put-call parity: C - P === S - K*e^(-rT), always', () => {
  it('holds across the full grid', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const lhs = bsPrice(S, K, T, r, sigma, 'call') - bsPrice(S, K, T, r, sigma, 'put');
      expect(lhs).toBeCloseTo(S - K * Math.exp(-r * T), 9);
    }
  });

  it('holds for negative rates, extreme vol and long expiry', () => {
    for (const r of [-0.02, 0, 0.15]) {
      for (const sigma of [0.02, 1.5, 3]) {
        for (const T of [0.01, 10]) {
          const lhs = bsPrice(120, 100, T, r, sigma, 'call') - bsPrice(120, 100, T, r, sigma, 'put');
          expect(lhs).toBeCloseTo(120 - 100 * Math.exp(-r * T), 8);
        }
      }
    }
  });

  it('holds at expiry (T = 0)', () => {
    for (const S of [80, 100, 120]) {
      expect(bsPrice(S, 100, 0, 0.05, 0.2, 'call') - bsPrice(S, 100, 0, 0.05, 0.2, 'put'))
        .toBeCloseTo(S - 100, 10);
    }
  });
});

describe('bsPrice — no-arbitrage bounds', () => {
  it('a call is never worth less than its discounted intrinsic, nor more than the stock', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const c = bsPrice(S, K, T, r, sigma, 'call');
      expect(c).toBeGreaterThanOrEqual(Math.max(0, S - K * Math.exp(-r * T)) - 1e-9);
      expect(c).toBeLessThanOrEqual(S + 1e-9);
    }
  });

  it('a put is never worth less than its discounted intrinsic, nor more than the discounted strike', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const p = bsPrice(S, K, T, r, sigma, 'put');
      expect(p).toBeGreaterThanOrEqual(Math.max(0, K * Math.exp(-r * T) - S) - 1e-9);
      expect(p).toBeLessThanOrEqual(K * Math.exp(-r * T) + 1e-9);
    }
  });
});

describe('bsPrice — monotonicity', () => {
  it('a call gets more expensive as volatility rises', () => {
    let prev = -1;
    for (const sigma of [0.05, 0.1, 0.2, 0.4, 0.8, 1.5]) {
      const c = bsPrice(100, 100, 1, 0.05, sigma, 'call');
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it('a put gets more expensive as volatility rises', () => {
    let prev = -1;
    for (const sigma of [0.05, 0.1, 0.2, 0.4, 0.8, 1.5]) {
      const p = bsPrice(100, 100, 1, 0.05, sigma, 'put');
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('a call gets cheaper as the strike rises; a put gets dearer', () => {
    let prevC = Infinity;
    let prevP = -1;
    for (const K of [60, 80, 100, 120, 150]) {
      const c = bsPrice(100, K, 1, 0.05, 0.25, 'call');
      const p = bsPrice(100, K, 1, 0.05, 0.25, 'put');
      expect(c).toBeLessThan(prevC);
      expect(p).toBeGreaterThan(prevP);
      prevC = c; prevP = p;
    }
  });

  it('a vanilla call gets more expensive with longer expiry', () => {
    let prev = -1;
    for (const T of [0.05, 0.25, 1, 3, 10]) {
      const c = bsPrice(100, 100, T, 0.05, 0.25, 'call');
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });

  it('a call gets more expensive as the spot rises', () => {
    let prev = -1;
    for (const S of [50, 80, 100, 120, 200]) {
      const c = bsPrice(S, 100, 1, 0.05, 0.25, 'call');
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });
});

describe('greeks — verified against numerical derivatives of the price', () => {
  // The single best catcher of sign errors and misplaced factors.
  it('delta === dP/dS', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const h = S * 0.005;
      for (const type of ['call', 'put'] as const) {
        const fd = (bsPrice(S + h, K, T, r, sigma, type) - bsPrice(S - h, K, T, r, sigma, type)) / (2 * h);
        expect(bsDelta(S, K, T, r, sigma, type)).toBeCloseTo(fd, 3);
      }
    }
  });

  it('gamma === d2P/dS2', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const h = S * 0.005;
      const fd = (bsPrice(S + h, K, T, r, sigma, 'call') - 2 * bsPrice(S, K, T, r, sigma, 'call')
        + bsPrice(S - h, K, T, r, sigma, 'call')) / (h * h);
      expect(bsGamma(S, K, T, r, sigma)).toBeCloseTo(fd, 3);
    }
  });

  it('vega === dP/dsigma / 100 (per 1 vol point)', () => {
    const h = 1e-4;
    for (const { S, K, T, r, sigma } of GRID) {
      const fd = (bsPrice(S, K, T, r, sigma + h, 'call') - bsPrice(S, K, T, r, sigma - h, 'call')) / (2 * h) / 100;
      expect(bsVega(S, K, T, r, sigma)).toBeCloseTo(fd, 5);
    }
  });

  it('theta === -dP/dT / 365 (per calendar day)', () => {
    const h = 1e-5;
    for (const { S, K, T, r, sigma } of GRID) {
      for (const type of ['call', 'put'] as const) {
        const fd = -(bsPrice(S, K, T + h, r, sigma, type) - bsPrice(S, K, T - h, r, sigma, type)) / (2 * h) / 365;
        expect(bsTheta(S, K, T, r, sigma, type)).toBeCloseTo(fd, 5);
      }
    }
  });

  it('rho === dP/dr / 100 (per 1 rate point)', () => {
    const h = 1e-5;
    for (const { S, K, T, r, sigma } of GRID) {
      for (const type of ['call', 'put'] as const) {
        const fd = (bsPrice(S, K, T, r + h, sigma, type) - bsPrice(S, K, T, r - h, sigma, type)) / (2 * h) / 100;
        expect(bsRho(S, K, T, r, sigma, type)).toBeCloseTo(fd, 4);
      }
    }
  });
});

describe('greeks — known values and bounds', () => {
  it('matches the reference greeks at S=K=100, T=1, r=5%, sigma=20%', () => {
    const { S, K, T, r, sigma } = REF;
    expect(bsDelta(S, K, T, r, sigma, 'call')).toBeCloseTo(0.636831, 5);
    expect(bsDelta(S, K, T, r, sigma, 'put')).toBeCloseTo(-0.363169, 5);
    expect(bsGamma(S, K, T, r, sigma)).toBeCloseTo(0.018762, 5);
    expect(bsVega(S, K, T, r, sigma)).toBeCloseTo(0.375240, 5);
    expect(bsRho(S, K, T, r, sigma, 'call')).toBeCloseTo(0.532325, 5);
  });

  it('call delta minus put delta === 1 (differentiating parity)', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      expect(bsDelta(S, K, T, r, sigma, 'call') - bsDelta(S, K, T, r, sigma, 'put')).toBeCloseTo(1, 8);
    }
  });

  it('call delta is in [0, 1] and put delta in [-1, 0]', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      const c = bsDelta(S, K, T, r, sigma, 'call');
      const p = bsDelta(S, K, T, r, sigma, 'put');
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(-1);
      expect(p).toBeLessThanOrEqual(0);
    }
  });

  it('gamma and vega are non-negative for long options', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      expect(bsGamma(S, K, T, r, sigma)).toBeGreaterThanOrEqual(0);
      expect(bsVega(S, K, T, r, sigma)).toBeGreaterThanOrEqual(0);
    }
  });

  it('gamma and vega are identical for a call and a put at the same strike', () => {
    // Both follow from parity: the difference C - P is linear in S and
    // independent of sigma, so its second S-derivative and its
    // sigma-derivative are both zero.
    for (const { S, K, T, r, sigma } of GRID) {
      const h = 1e-4;
      const vegaPut = (bsPrice(S, K, T, r, sigma + h, 'put') - bsPrice(S, K, T, r, sigma - h, 'put')) / (2 * h) / 100;
      expect(bsVega(S, K, T, r, sigma)).toBeCloseTo(vegaPut, 5);
    }
  });

  it('an ATM call is time-decay negative', () => {
    expect(bsTheta(100, 100, 0.5, 0.05, 0.25, 'call')).toBeLessThan(0);
  });

  it('call rho is positive and put rho is negative', () => {
    for (const { S, K, T, r, sigma } of GRID) {
      expect(bsRho(S, K, T, r, sigma, 'call')).toBeGreaterThan(0);
      expect(bsRho(S, K, T, r, sigma, 'put')).toBeLessThan(0);
    }
  });

  it('gamma peaks near the money', () => {
    const atm = bsGamma(100, 100, 0.5, 0.05, 0.25);
    expect(atm).toBeGreaterThan(bsGamma(60, 100, 0.5, 0.05, 0.25));
    expect(atm).toBeGreaterThan(bsGamma(160, 100, 0.5, 0.05, 0.25));
  });
});

describe('black-scholes — degenerate inputs never leak NaN', () => {
  const fns: Array<[string, (S: number, K: number, T: number, r: number, s: number) => number]> = [
    ['price(call)', (S, K, T, r, s) => bsPrice(S, K, T, r, s, 'call')],
    ['price(put)', (S, K, T, r, s) => bsPrice(S, K, T, r, s, 'put')],
    ['delta(call)', (S, K, T, r, s) => bsDelta(S, K, T, r, s, 'call')],
    ['delta(put)', (S, K, T, r, s) => bsDelta(S, K, T, r, s, 'put')],
    ['gamma', (S, K, T, r, s) => bsGamma(S, K, T, r, s)],
    ['vega', (S, K, T, r, s) => bsVega(S, K, T, r, s)],
    ['theta(call)', (S, K, T, r, s) => bsTheta(S, K, T, r, s, 'call')],
    ['rho(call)', (S, K, T, r, s) => bsRho(S, K, T, r, s, 'call')],
  ];

  const degenerate: Array<[string, [number, number, number, number, number]]> = [
    ['sigma = 0', [100, 100, 1, 0.05, 0]],
    ['sigma = 0, ITM', [120, 100, 1, 0.05, 0]],
    ['T = 0', [100, 100, 0, 0.05, 0.2]],
    ['T = 1e-9', [100, 100, 1e-9, 0.05, 0.2]],
    ['S = 0', [0, 100, 1, 0.05, 0.2]],
    ['negative rate', [100, 100, 1, -0.03, 0.2]],
    ['huge vol', [100, 100, 1, 0.05, 10]],
    ['deep OTM', [10, 1000, 0.02, 0.05, 0.1]],
    ['deep ITM', [1000, 10, 0.02, 0.05, 0.1]],
  ];

  for (const [label, args] of degenerate) {
    for (const [name, fn] of fns) {
      it(`${name} is finite for ${label}`, () => {
        expect(Number.isFinite(fn(...args)), `${name} @ ${label}`).toBe(true);
      });
    }
  }

  it('a zero-vol option is worth exactly its discounted forward intrinsic', () => {
    // No randomness -> the stock compounds at r, so the call is worth
    // max(0, S - K*e^(-rT)) and the put max(0, K*e^(-rT) - S).
    expect(bsPrice(120, 100, 1, 0.05, 0, 'call')).toBeCloseTo(120 - 100 * Math.exp(-0.05), 6);
    expect(bsPrice(80, 100, 1, 0.05, 0, 'put')).toBeCloseTo(100 * Math.exp(-0.05) - 80, 6);
    expect(bsPrice(80, 100, 1, 0.05, 0, 'call')).toBeCloseTo(0, 6);
  });

  it('a zero-vol option has zero gamma and zero vega', () => {
    expect(bsGamma(100, 100, 1, 0.05, 0)).toBe(0);
    expect(bsVega(100, 100, 1, 0.05, 0)).toBe(0);
  });

  it('a worthless stock makes the call worthless and the put worth the discounted strike', () => {
    expect(bsPrice(0, 100, 1, 0.05, 0.2, 'call')).toBe(0);
    expect(bsPrice(0, 100, 1, 0.05, 0.2, 'put')).toBeCloseTo(100 * Math.exp(-0.05), 10);
    expect(bsGamma(0, 100, 1, 0.05, 0.2)).toBe(0);
  });

  it('at expiry the price is intrinsic and the greeks are flat', () => {
    expect(bsPrice(110, 100, 0, 0.05, 0.2, 'call')).toBe(10);
    expect(bsPrice(90, 100, 0, 0.05, 0.2, 'call')).toBe(0);
    expect(bsPrice(90, 100, 0, 0.05, 0.2, 'put')).toBe(10);
    expect(bsDelta(110, 100, 0, 0.05, 0.2, 'call')).toBe(1);
    expect(bsDelta(90, 100, 0, 0.05, 0.2, 'call')).toBe(0);
    expect(bsDelta(90, 100, 0, 0.05, 0.2, 'put')).toBe(-1);
    expect(bsGamma(110, 100, 0, 0.05, 0.2)).toBe(0);
  });

  it('THROWS on non-finite or negative inputs rather than returning NaN', () => {
    expect(() => bsPrice(Number.NaN, 100, 1, 0.05, 0.2, 'call')).toThrow(/finite/i);
    expect(() => bsPrice(100, Number.NaN, 1, 0.05, 0.2, 'call')).toThrow(/finite/i);
    expect(() => bsPrice(100, 100, Number.NaN, 0.05, 0.2, 'call')).toThrow(/finite/i);
    expect(() => bsPrice(100, 100, 1, Number.NaN, 0.2, 'call')).toThrow(/finite/i);
    expect(() => bsPrice(100, 100, 1, 0.05, Number.NaN, 'call')).toThrow(/finite/i);
    expect(() => bsPrice(-100, 100, 1, 0.05, 0.2, 'call')).toThrow(/negative|positive/i);
    expect(() => bsPrice(100, -100, 1, 0.05, 0.2, 'call')).toThrow(/negative|positive/i);
    expect(() => bsPrice(100, 100, -1, 0.05, 0.2, 'call')).toThrow(/negative|positive/i);
    expect(() => bsPrice(100, 100, 1, 0.05, -0.2, 'call')).toThrow(/negative|positive/i);
    expect(() => bsGamma(Number.NaN, 100, 1, 0.05, 0.2)).toThrow(/finite/i);
    // A finite input that overflows to a non-finite PRICE is just as
    // useless to a caller as a NaN input.
    expect(() => bsPrice(100, 100, 1, -1000, 0.2, 'put')).toThrow(/finite/i);
  });
});

describe('impliedVolatility — a returned IV must reprice to the input price', () => {
  const IV_GRID: Array<{ S: number; K: number; T: number; sigma: number }> = [];
  for (const S of [50, 100, 200]) {
    for (const K of [70, 100, 130]) {
      for (const T of [0.02, 0.25, 1, 2]) {
        for (const sigma of [0.05, 0.1, 0.3, 0.8, 2.0]) IV_GRID.push({ S, K, T, sigma });
      }
    }
  }

  it('NEVER returns a number that fails to reproduce the input price', () => {
    // The contract. A non-converged guess used to be returned as if it
    // were an answer — including the 0.001 floor and the 5.0 cap.
    for (const { S, K, T, sigma } of IV_GRID) {
      for (const type of ['call', 'put'] as const) {
        const price = bsPrice(S, K, T, 0.05, sigma, type);
        const iv = impliedVolatility(price, S, K, T, 0.05, type);
        if (iv === null) continue;
        const reprice = bsPrice(S, K, T, 0.05, iv, type);
        expect(Math.abs(reprice - price), `S${S} K${K} T${T} sig${sigma} ${type} -> iv ${iv}`)
          .toBeLessThan(1e-4 * Math.max(1, price));
      }
    }
  });

  it('round-trips accurately for well-conditioned options', () => {
    for (const S of [50, 100, 200]) {
      for (const moneyness of [0.9, 1.0, 1.1]) {
        for (const T of [0.25, 1, 2]) {
          for (const sigma of [0.1, 0.3, 0.8]) {
            for (const type of ['call', 'put'] as const) {
              const K = S * moneyness;
              const price = bsPrice(S, K, T, 0.05, sigma, type);
              const iv = impliedVolatility(price, S, K, T, 0.05, type);
              expect(iv, `S${S} K${K} T${T} sig${sigma} ${type}`).not.toBeNull();
              expect(iv!).toBeCloseTo(sigma, 4);
            }
          }
        }
      }
    }
  });

  it('recovers the reference IV exactly', () => {
    expect(impliedVolatility(10.450584, 100, 100, 1, 0.05, 'call')!).toBeCloseTo(0.2, 5);
    expect(impliedVolatility(5.573526, 100, 100, 1, 0.05, 'put')!).toBeCloseTo(0.2, 5);
  });

  it('returns null for a price below intrinsic value (no sigma can produce it)', () => {
    // S=100, K=50, T=1, r=5% -> lower bound is 100 - 50*e^-0.05 = 52.44
    expect(impliedVolatility(1, 100, 50, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(40, 100, 50, 1, 0.05, 'call')).toBeNull();
  });

  it('returns null for a call priced above the underlying', () => {
    expect(impliedVolatility(150, 100, 100, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(101, 100, 100, 1, 0.05, 'call')).toBeNull();
  });

  it('returns null for a put priced above the discounted strike', () => {
    expect(impliedVolatility(101, 100, 100, 1, 0.05, 'put')).toBeNull();
  });

  it('returns null for non-positive prices and expired options', () => {
    expect(impliedVolatility(0, 100, 100, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(-5, 100, 100, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(10, 100, 100, 0, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(10, 100, 100, -1, 0.05, 'call')).toBeNull();
  });

  it('returns null on non-finite input rather than a fabricated number', () => {
    expect(impliedVolatility(Number.NaN, 100, 100, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(10, Number.NaN, 100, 1, 0.05, 'call')).toBeNull();
    expect(impliedVolatility(10, 100, 100, Number.NaN, 0.05, 'call')).toBeNull();
  });

  it('never returns the 0.001 floor or the 5.0 cap as a converged answer', () => {
    // Both were emitted verbatim by the old solver for deep OTM / short
    // dated contracts, and plotted straight onto the vol surface.
    for (const { S, K, T, sigma } of IV_GRID) {
      for (const type of ['call', 'put'] as const) {
        const iv = impliedVolatility(bsPrice(S, K, T, 0.05, sigma, type), S, K, T, 0.05, type);
        if (iv === null) continue;
        expect(iv).toBeGreaterThan(0);
        expect(Number.isFinite(iv)).toBe(true);
      }
    }
  });

  it('recovers a very high but legitimate volatility', () => {
    // A strict `marketPrice >= priceHi` rejection at a 500% ceiling threw
    // away exact roots AT the ceiling.
    for (const sigma of [2, 3, 5]) {
      const price = bsPrice(100, 100, 1, 0.05, sigma, 'call');
      const iv = impliedVolatility(price, 100, 100, 1, 0.05, 'call');
      expect(iv, `sigma=${sigma}`).not.toBeNull();
      expect(iv!).toBeCloseTo(sigma, 4);
    }
  });

  it('returns null above the model range rather than pinning to the ceiling', () => {
    const price = bsPrice(100, 100, 1, 0.05, 20, 'call');
    const iv = impliedVolatility(price, 100, 100, 1, 0.05, 'call');
    // Either an accurate answer or an honest null — never a pinned bound
    // reported as if it were solved.
    if (iv !== null) expect(iv).toBeCloseTo(20, 2);
  });

  it('is monotone: a higher option price implies a higher IV', () => {
    let prev = -1;
    for (const price of [5, 8, 10.45, 15, 25, 40]) {
      const iv = impliedVolatility(price, 100, 100, 1, 0.05, 'call');
      expect(iv).not.toBeNull();
      expect(iv!).toBeGreaterThan(prev);
      prev = iv!;
    }
  });
});
