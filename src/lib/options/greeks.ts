/**
 * Black-Scholes Option Pricing & Greeks — thin adapter over
 * `src/lib/black-scholes.ts`.
 *
 * This file used to carry a SECOND, independent copy of the pricing
 * model and every greek. The two agreed numerically, but duplicated
 * math is a latent divergence: the NaN-gamma fix (raw sigma in the
 * denominator while d1 used a clamped one) had to be applied twice, and
 * the next fix would have been applied to only one of them.
 *
 * The public API here is unchanged — only the argument order differs
 * from the canonical module, which is why the adapter exists at all.
 */
import type { GreeksResult } from './types';
import {
  bsPrice, bsDelta, bsGamma, bsTheta, bsVega, bsRho, impliedVolatility,
} from '../black-scholes';

/**
 * Black-Scholes option price
 * @param S - Current stock price
 * @param K - Strike price
 * @param T - Time to expiration in years
 * @param r - Risk-free interest rate (e.g. 0.05 for 5%)
 * @param sigma - Implied volatility (e.g. 0.30 for 30%)
 * @param type - 'call' or 'put'
 */
export function blackScholesPrice(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  return bsPrice(S, K, T, r, sigma, type);
}

/**
 * Calculate all Greeks for an option. Theta is per calendar day; vega
 * and rho are per 1 percentage point.
 */
export function calculateGreeks(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): GreeksResult {
  return {
    price: bsPrice(S, K, T, r, sigma, type),
    delta: bsDelta(S, K, T, r, sigma, type),
    gamma: bsGamma(S, K, T, r, sigma),
    theta: bsTheta(S, K, T, r, sigma, type),
    vega: bsVega(S, K, T, r, sigma),
    rho: bsRho(S, K, T, r, sigma, type),
  };
}

/**
 * Solve for implied volatility.
 *
 * @returns the implied volatility, or `null` when none exists (price
 *   outside the no-arbitrage band) or cannot be determined. It never
 *   returns a non-converged guess — see impliedVolatility().
 */
export function solveIV(
  S: number, K: number, T: number, r: number, marketPrice: number, type: 'call' | 'put',
  maxIterations = 100, tolerance = 1e-10
): number | null {
  return impliedVolatility(marketPrice, S, K, T, r, type, maxIterations, tolerance);
}

/**
 * Calculate payoff at expiration for a single option leg, in dollars
 * (100 shares per contract).
 */
export function optionPayoff(
  type: 'call' | 'put',
  strike: number,
  premium: number,
  quantity: number,
  isLong: boolean,
  priceAtExpiry: number
): number {
  const intrinsic = type === 'call'
    ? Math.max(priceAtExpiry - strike, 0)
    : Math.max(strike - priceAtExpiry, 0);

  const sign = isLong ? 1 : -1;
  return (intrinsic - premium) * sign * quantity * 100;
}

/**
 * Evenly spaced sample prices spanning [low, high] INCLUSIVE.
 *
 * Indexed rather than accumulated: `for (p = low; p <= high; p += step)`
 * accumulates floating-point error, so whether the top of the range is
 * sampled at all depends on rounding.
 */
function priceLadder(currentPrice: number, range: number, points: number): number[] {
  const low = currentPrice * (1 - range);
  const high = currentPrice * (1 + range);
  const n = Math.max(1, Math.floor(points));
  return Array.from({ length: n + 1 }, (_, i) => low + ((high - low) * i) / n);
}

/**
 * Calculate combined payoff for multiple legs at a range of prices
 * Returns array of { price, pnl } points for charting
 */
export function multiLegPayoff(
  legs: {
    type: 'call' | 'put';
    strike: number;
    premium: number;
    quantity: number;
    isLong: boolean;
  }[],
  currentPrice: number,
  range = 0.3, // ±30% from current price
  points = 100
): { price: number; pnl: number }[] {
  return priceLadder(currentPrice, range, points).map((p) => {
    let totalPnl = 0;
    for (const leg of legs) {
      totalPnl += optionPayoff(leg.type, leg.strike, leg.premium, leg.quantity, leg.isLong, p);
    }
    return { price: Math.round(p * 100) / 100, pnl: Math.round(totalPnl * 100) / 100 };
  });
}

/**
 * Calculate current (pre-expiration) payoff using Black-Scholes
 */
export function multiLegCurrentValue(
  legs: {
    type: 'call' | 'put';
    strike: number;
    premium: number;
    quantity: number;
    isLong: boolean;
    expiration: string; // ISO date
  }[],
  currentPrice: number,
  r: number,
  sigma: number,
  range = 0.3,
  points = 100
): { price: number; pnl: number }[] {
  const now = Date.now();

  return priceLadder(currentPrice, range, points).map((p) => {
    let totalPnl = 0;
    for (const leg of legs) {
      const T = Math.max((new Date(leg.expiration).getTime() - now) / (365.25 * 24 * 3600 * 1000), 0);
      const theoreticalPrice = blackScholesPrice(p, leg.strike, T, r, sigma, leg.type);
      const sign = leg.isLong ? 1 : -1;
      totalPnl += (theoreticalPrice - leg.premium) * sign * leg.quantity * 100;
    }
    return { price: Math.round(p * 100) / 100, pnl: Math.round(totalPnl * 100) / 100 };
  });
}
