/**
 * Full Black-Scholes Option Pricing Library
 * Standalone implementation for the Alpha Engine P&L simulator
 */

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

// d1 and d2
function d1d2(S: number, K: number, T: number, r: number, sigma: number): [number, number] {
  const s = Math.max(sigma, 0.001);
  const t = Math.max(T, 0.0001);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * t) / (s * Math.sqrt(t));
  const d2 = d1 - s * Math.sqrt(t);
  return [d1, d2];
}

/**
 * Black-Scholes option price
 */
export function bsPrice(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  if (T <= 0) {
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  if (type === 'call') {
    return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  }
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

/**
 * Delta
 */
export function bsDelta(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  if (T <= 0) {
    const itm = type === 'call' ? S > K : S < K;
    return itm ? (type === 'call' ? 1 : -1) : 0;
  }
  const [d1] = d1d2(S, K, T, r, sigma);
  return type === 'call' ? normalCDF(d1) : normalCDF(d1) - 1;
}

/**
 * Gamma (same for call and put)
 */
export function bsGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return 0;
  const [d1] = d1d2(S, K, T, r, sigma);
  return normalPDF(d1) / (S * sigma * Math.sqrt(T));
}

/**
 * Theta (daily, per 1 share)
 */
export function bsTheta(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  if (T <= 0) return 0;
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);
  const term1 = -S * normalPDF(d1) * sigma / (2 * sqrtT);
  if (type === 'call') {
    return (term1 - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
  }
  return (term1 + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
}

/**
 * Vega (per 1% change in IV)
 */
export function bsVega(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return 0;
  const [d1] = d1d2(S, K, T, r, sigma);
  return S * normalPDF(d1) * Math.sqrt(T) / 100;
}

/**
 * Rho (per 1% change in rate)
 */
export function bsRho(
  S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'
): number {
  if (T <= 0) return 0;
  const [, d2] = d1d2(S, K, T, r, sigma);
  if (type === 'call') {
    return K * T * Math.exp(-r * T) * normalCDF(d2) / 100;
  }
  return -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;
}

/**
 * Implied Volatility solver (Newton-Raphson)
 */
export function impliedVolatility(
  marketPrice: number, S: number, K: number, T: number, r: number, type: 'call' | 'put',
  maxIter = 100, tol = 0.0001
): number | null {
  if (T <= 0 || marketPrice <= 0) return null;

  let sigma = Math.sqrt(2 * Math.PI / T) * (marketPrice / S);
  if (sigma <= 0 || !isFinite(sigma)) sigma = 0.3;

  for (let i = 0; i < maxIter; i++) {
    const price = bsPrice(S, K, T, r, sigma, type);
    const vega = bsVega(S, K, T, r, sigma) * 100; // undo /100
    if (Math.abs(vega) < 1e-10) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return sigma;
    sigma -= diff / vega;
    if (sigma <= 0) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }
  return sigma;
}
