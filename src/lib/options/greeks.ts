// Black-Scholes Option Pricing & Greeks Calculations
import type { GreeksResult } from './types';

// Standard normal CDF approximation (Abramowitz & Stegun)
function normCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate d1 and d2 for Black-Scholes
 */
function calcD1D2(S: number, K: number, T: number, r: number, sigma: number): [number, number] {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return [d1, d2];
}

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
  if (T <= 0) {
    // At or past expiration — intrinsic value only
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }

  const [d1, d2] = calcD1D2(S, K, T, r, sigma);

  if (type === 'call') {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  } else {
    return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  }
}

/**
 * Calculate all Greeks for an option
 */
export function calculateGreeks(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): GreeksResult {
  if (T <= 0) {
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = type === 'call' ? S > K : S < K;
    return {
      price: intrinsic,
      delta: itm ? (type === 'call' ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const [d1, d2] = calcD1D2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);
  const nd1 = normPDF(d1);
  const Nd1 = normCDF(d1);
  const Nd2 = normCDF(d2);
  const expRT = Math.exp(-r * T);

  const price = blackScholesPrice(S, K, T, r, sigma, type);

  let delta: number;
  let theta: number;
  let rho: number;

  if (type === 'call') {
    delta = Nd1;
    theta = (-S * nd1 * sigma / (2 * sqrtT)) - r * K * expRT * Nd2;
    rho = K * T * expRT * Nd2 / 100;
  } else {
    delta = Nd1 - 1;
    theta = (-S * nd1 * sigma / (2 * sqrtT)) + r * K * expRT * normCDF(-d2);
    rho = -K * T * expRT * normCDF(-d2) / 100;
  }

  const gamma = nd1 / (S * sigma * sqrtT);
  const vega = S * nd1 * sqrtT / 100; // Per 1% change in IV

  return {
    price,
    delta,
    gamma,
    theta: theta / 365, // Daily theta
    vega,
    rho,
  };
}

/**
 * Solve for implied volatility using Newton-Raphson method
 * @param marketPrice - The observed market price of the option
 * @returns Implied volatility or null if no convergence
 */
export function solveIV(
  S: number, K: number, T: number, r: number, marketPrice: number, type: 'call' | 'put',
  maxIterations = 100, tolerance = 0.0001
): number | null {
  if (T <= 0 || marketPrice <= 0) return null;

  // Initial guess based on Brenner-Subrahmanyam approximation
  let sigma = Math.sqrt(2 * Math.PI / T) * (marketPrice / S);
  if (sigma <= 0 || !isFinite(sigma)) sigma = 0.3;

  for (let i = 0; i < maxIterations; i++) {
    const price = blackScholesPrice(S, K, T, r, sigma, type);
    const vega = calculateGreeks(S, K, T, r, sigma, type).vega * 100; // Undo the /100

    if (Math.abs(vega) < 1e-10) break; // Vega too small to adjust

    const diff = price - marketPrice;
    if (Math.abs(diff) < tolerance) return sigma;

    sigma -= diff / vega;
    if (sigma <= 0) sigma = 0.001;
    if (sigma > 5) sigma = 5; // Cap at 500% IV
  }

  return sigma; // Return best guess even without full convergence
}

/**
 * Calculate payoff at expiration for a single option leg
 */
export function optionPayoff(
  type: 'call' | 'put',
  strike: number,
  premium: number,
  quantity: number,
  isLong: boolean,
  priceAtExpiry: number
): number {
  let intrinsic: number;
  if (type === 'call') {
    intrinsic = Math.max(priceAtExpiry - strike, 0);
  } else {
    intrinsic = Math.max(strike - priceAtExpiry, 0);
  }

  const sign = isLong ? 1 : -1;
  return (intrinsic * sign - premium * (isLong ? 1 : -1)) * quantity * 100;
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
  const low = currentPrice * (1 - range);
  const high = currentPrice * (1 + range);
  const step = (high - low) / points;

  const results: { price: number; pnl: number }[] = [];

  for (let p = low; p <= high; p += step) {
    let totalPnl = 0;
    for (const leg of legs) {
      totalPnl += optionPayoff(leg.type, leg.strike, leg.premium, leg.quantity, leg.isLong, p);
    }
    results.push({ price: Math.round(p * 100) / 100, pnl: Math.round(totalPnl * 100) / 100 });
  }

  return results;
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
  const low = currentPrice * (1 - range);
  const high = currentPrice * (1 + range);
  const step = (high - low) / points;
  const now = Date.now();

  const results: { price: number; pnl: number }[] = [];

  for (let p = low; p <= high; p += step) {
    let totalPnl = 0;
    for (const leg of legs) {
      const T = Math.max((new Date(leg.expiration).getTime() - now) / (365.25 * 24 * 3600 * 1000), 0);
      const theoreticalPrice = blackScholesPrice(p, leg.strike, T, r, sigma, leg.type);
      const sign = leg.isLong ? 1 : -1;
      const pnl = (theoreticalPrice * sign - leg.premium * (leg.isLong ? 1 : -1)) * leg.quantity * 100;
      totalPnl += pnl;
    }
    results.push({ price: Math.round(p * 100) / 100, pnl: Math.round(totalPnl * 100) / 100 });
  }

  return results;
}
