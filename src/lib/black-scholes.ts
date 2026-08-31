/**
 * Full Black-Scholes Option Pricing Library
 * Standalone implementation for the Alpha Engine P&L simulator
 *
 * Numerical contract
 * ------------------
 * - Put-call parity C - P = S - K*e^(-rT) holds to machine precision for
 *   every input, because normalCDF(x) + normalCDF(-x) === 1 by construction.
 * - Every greek matches a central finite difference of `bsPrice`.
 * - `sigma` and `T` are clamped to small positive floors inside the model
 *   so a zero-vol or zero-time contract is priced as its discounted
 *   forward intrinsic rather than dividing by zero. ALL greeks use the
 *   same clamped values the price used — reading the raw sigma in the
 *   gamma denominator while d1 used the clamped one produced 0/0 = NaN,
 *   which serialised to `null` on the options chain API.
 * - Malformed input (non-finite, negative price/strike/time/vol) THROWS.
 *   It never returns NaN: a NaN greek renders as a confident blank cell.
 */

import { isFiniteNumber } from './finite';

const SIGMA_FLOOR = 0.001;
const T_FLOOR = 0.0001;

// Standard normal CDF (Abramowitz & Stegun approximation)
export function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Reject anything that cannot be priced. Inputs come from Alpaca / FMP
 * option chains, so a missing field is a realistic caller error.
 */
function assertPriceable(S: number, K: number, T: number, r: number, sigma: number): void {
  if (!isFiniteNumber(S) || !isFiniteNumber(K) || !isFiniteNumber(T) ||
      !isFiniteNumber(r) || !isFiniteNumber(sigma)) {
    throw new Error(
      `black-scholes: all inputs must be finite (S=${S}, K=${K}, T=${T}, r=${r}, sigma=${sigma}).`,
    );
  }
  if (S < 0) throw new Error(`black-scholes: spot must be non-negative (got ${S}).`);
  if (K < 0) throw new Error(`black-scholes: strike must be non-negative (got ${K}).`);
  if (T < 0) throw new Error(`black-scholes: time to expiry must be non-negative (got ${T}).`);
  if (sigma < 0) throw new Error(`black-scholes: volatility must be non-negative (got ${sigma}).`);
}

/**
 * d1, d2 plus the EFFECTIVE sigma and T actually used. Callers must use
 * the returned s/t in their own denominators so every greek is
 * consistent with the price that was quoted.
 */
function d1d2(S: number, K: number, T: number, r: number, sigma: number): {
  d1: number; d2: number; s: number; t: number;
} {
  const s = Math.max(sigma, SIGMA_FLOOR);
  const t = Math.max(T, T_FLOOR);
  const sqrtT = s * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * t) / sqrtT;
  const d2 = d1 - sqrtT;
  return { d1, d2, s, t };
}

/**
 * Black-Scholes option price
 */
export function bsPrice(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) {
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  // S = 0 is absorbing: the call expires worthless, the put pays the
  // discounted strike with certainty. log(0) would otherwise be -Infinity.
  if (S === 0) return type === 'call' ? 0 : K * Math.exp(-r * T);
  if (K === 0) return type === 'call' ? S : 0;

  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const price = type === 'call'
    ? S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2)
    : K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);

  // Finite inputs can still overflow — e.g. r = -1000 makes e^(-rT)
  // Infinity. An Infinite price is as useless to a caller as a NaN one.
  if (!isFiniteNumber(price)) {
    throw new Error(
      `black-scholes: inputs produced a non-finite price (S=${S}, K=${K}, T=${T}, r=${r}, sigma=${sigma}).`,
    );
  }
  return price;
}

/**
 * Delta
 */
export function bsDelta(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) {
    const itm = type === 'call' ? S > K : S < K;
    return itm ? (type === 'call' ? 1 : -1) : 0;
  }
  if (S === 0) return type === 'call' ? 0 : -1;
  if (K === 0) return type === 'call' ? 1 : 0;

  const { d1 } = d1d2(S, K, T, r, sigma);
  return type === 'call' ? normalCDF(d1) : normalCDF(d1) - 1;
}

/**
 * Gamma (same for call and put)
 */
export function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) return 0;
  // A worthless or strike-less contract has no convexity, and dividing
  // by S = 0 is what produced NaN here.
  if (S === 0 || K === 0) return 0;

  const { d1, s, t } = d1d2(S, K, T, r, sigma);
  return normalPDF(d1) / (S * s * Math.sqrt(t));
}

/**
 * Theta (daily, per 1 share)
 */
export function bsTheta(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) return 0;
  if (S === 0 || K === 0) {
    // Only the discounted-strike leg is left, and it accretes at r.
    if (S === 0 && type === 'put') return -r * K * Math.exp(-r * T) / 365;
    return 0;
  }

  const { d1, d2, s, t } = d1d2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(t);
  const term1 = -S * normalPDF(d1) * s / (2 * sqrtT);
  if (type === 'call') {
    return (term1 - r * K * Math.exp(-r * t) * normalCDF(d2)) / 365;
  }
  return (term1 + r * K * Math.exp(-r * t) * normalCDF(-d2)) / 365;
}

/**
 * Vega (per 1% change in IV)
 */
export function bsVega(S: number, K: number, T: number, r: number, sigma: number): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) return 0;
  if (S === 0 || K === 0) return 0;

  const { d1, t } = d1d2(S, K, T, r, sigma);
  return S * normalPDF(d1) * Math.sqrt(t) / 100;
}

/**
 * Rho (per 1% change in rate)
 */
export function bsRho(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  assertPriceable(S, K, T, r, sigma);
  if (T <= 0) return 0;
  if (K === 0) return 0;
  if (S === 0) return type === 'put' ? -K * T * Math.exp(-r * T) / 100 : 0;

  const { d2, t } = d1d2(S, K, T, r, sigma);
  if (type === 'call') {
    return K * t * Math.exp(-r * t) * normalCDF(d2) / 100;
  }
  return -K * t * Math.exp(-r * t) * normalCDF(-d2) / 100;
}

// ---------------------------------------------------------------------------
// Implied volatility
// ---------------------------------------------------------------------------

/**
 * Widest volatility the solver will search: 1000% annualised, far beyond
 * anything a real listed option trades at. It is deliberately wider than
 * the 500% the old solver clamped to, because a strict endpoint
 * rejection at the ceiling threw away exact roots that sat ON it.
 */
const IV_MAX = 10;
/** Narrowest. Below this an option is priced at its forward intrinsic. */
const IV_MIN = 1e-6;

/**
 * Implied Volatility solver.
 *
 * Returns `null` whenever an implied volatility does not exist or cannot
 * be determined — NOT a non-converged guess.
 *
 * The previous Newton-Raphson implementation returned its last iterate
 * unconditionally: it `break`-ed out when vega underflowed and fell out
 * of the loop after maxIter, so a deep-OTM or nearly-expired contract
 * came back as the 0.001 floor or the 5.0 cap, and a price below
 * intrinsic came back as a small positive number. Those fabricated
 * values were plotted directly onto the vol surface.
 *
 * The solver now:
 *   1. rejects prices outside the no-arbitrage band [intrinsic, max]
 *   2. rejects prices indistinguishable from that band (any sigma fits,
 *      so the IV is genuinely indeterminate)
 *   3. brackets on [IV_MIN, IV_MAX] — price is strictly increasing in
 *      sigma, so a bracket that contains the price contains the root
 *   4. runs Newton steps, falling back to bisection whenever a step
 *      leaves the bracket (guaranteed convergence, Newton's speed)
 *   5. verifies the answer REPRICES to the input before returning it
 */
export function impliedVolatility(
  marketPrice: number, S: number, K: number, T: number, r: number, type: 'call' | 'put',
  maxIter = 100, tol = 1e-10
): number | null {
  if (!isFiniteNumber(marketPrice) || !isFiniteNumber(S) || !isFiniteNumber(K) ||
      !isFiniteNumber(T) || !isFiniteNumber(r)) return null;
  if (T <= 0 || marketPrice <= 0 || S <= 0 || K <= 0) return null;

  // --- 1 & 2: no-arbitrage band ---------------------------------------
  const discountedK = K * Math.exp(-r * T);
  const lower = type === 'call' ? Math.max(0, S - discountedK) : Math.max(0, discountedK - S);
  const upper = type === 'call' ? S : discountedK;

  // Prices within this band of an endpoint are indistinguishable from it
  // in double precision, so no sigma is recoverable.
  const band = 1e-8 * Math.max(1, S);
  if (marketPrice <= lower + band) return null;
  if (marketPrice >= upper - band) return null;

  // --- 3: bracket ------------------------------------------------------
  let lo = IV_MIN;
  let hi = IV_MAX;
  const priceLo = bsPrice(S, K, T, r, lo, type);
  const priceHi = bsPrice(S, K, T, r, hi, type);
  // A price exactly AT an endpoint has that endpoint as its exact root,
  // so accept it rather than rejecting the boundary. Outside the bracket
  // the volatility is beyond the model range: report null, never a
  // pinned bound dressed up as a solved value.
  if (marketPrice < priceLo || marketPrice > priceHi) return null;
  if (marketPrice === priceLo) return lo;
  if (marketPrice === priceHi) return hi;

  // --- 4: safeguarded Newton -------------------------------------------
  let sigma = Math.min(hi, Math.max(lo, Math.sqrt((2 * Math.PI) / T) * (marketPrice / S)));
  if (!isFiniteNumber(sigma) || sigma <= 0) sigma = 0.3;

  for (let i = 0; i < maxIter; i++) {
    const price = bsPrice(S, K, T, r, sigma, type);
    const diff = price - marketPrice;

    if (diff > 0) hi = sigma; else lo = sigma;
    if (hi - lo < tol) break;

    const vega = bsVega(S, K, T, r, sigma) * 100; // undo the /100
    let next = vega > 1e-12 ? sigma - diff / vega : Number.NaN;
    // Reject a Newton step that leaves the bracket or is not a number.
    if (!isFiniteNumber(next) || next <= lo || next >= hi) next = 0.5 * (lo + hi);
    if (Math.abs(next - sigma) < tol) { sigma = next; break; }
    sigma = next;
  }

  // --- 5: the answer must reprice to the input -------------------------
  const check = bsPrice(S, K, T, r, sigma, type);
  if (Math.abs(check - marketPrice) > 1e-6 * Math.max(1, marketPrice)) return null;
  if (!isFiniteNumber(sigma) || sigma <= 0) return null;
  return sigma;
}
