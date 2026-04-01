/**
 * IV Surface + Skew Analyzer Library
 * Builds volatility surfaces, analyzes skew patterns, term structure,
 * and identifies mispricings across strike/expiry grids.
 */

import { impliedVolatility } from './black-scholes';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VolSurfacePoint {
  strike: number;
  expiry: string;
  iv: number;
  delta?: number;
}

export interface VolSurface {
  grid: VolSurfacePoint[];
  strikes: number[];
  expirations: string[];
}

export interface SkewAnalysis {
  skewType: 'negative' | 'positive' | 'smile';
  putSkew25d: number;
  callSkew25d: number;
  riskReversal: number;
  butterfly: number;
  skewSlope: number;
  interpretation: string;
}

export interface TermStructure {
  points: { expiry: string; iv: number }[];
  shape: 'contango' | 'backwardation' | 'flat';
}

export interface Mispricing {
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  currentIV: number;
  expectedIV: number;
  edge: number;
  direction: 'overpriced' | 'underpriced';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Days between now and the given date string, floored to at least 1 day. */
function daysToExpiry(expiry: string): number {
  const expiryDate = new Date(expiry);
  const now = new Date();
  const msPerDay = 86_400_000;
  const days = Math.ceil((expiryDate.getTime() - now.getTime()) / msPerDay);
  return Math.max(days, 1);
}

/** Approximate Black-Scholes delta for sorting/labeling purposes. */
function approxDelta(
  S: number,
  K: number,
  T: number,
  r: number,
  iv: number,
  type: 'call' | 'put'
): number {
  if (T <= 0 || iv <= 0) return type === 'call' ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0);
  const d1 =
    (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
  // Simple normal CDF approximation
  const nd1 = 0.5 * (1 + erf(d1 / Math.SQRT2));
  return type === 'call' ? nd1 : nd1 - 1;
}

/** Error function approximation (Abramowitz & Stegun). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Build a volatility surface from a list of option quotes.
 *
 * For each option, IV is computed via Newton's method (black-scholes.ts).
 * Returns the full grid plus sorted unique strikes and expirations.
 */
export function buildVolSurface(
  options: Array<{
    strike: number;
    expiry: string;
    price: number;
    type: 'call' | 'put';
    spotPrice: number;
  }>,
  spotPrice: number,
  riskFreeRate: number = 0.05
): VolSurface {
  const grid: VolSurfacePoint[] = [];
  const strikeSet = new Set<number>();
  const expirySet = new Set<string>();

  for (const opt of options) {
    const days = daysToExpiry(opt.expiry);
    const T = days / 365;

    const iv = impliedVolatility(
      opt.price,
      opt.spotPrice,
      opt.strike,
      T,
      riskFreeRate,
      opt.type
    );

    if (iv === null || iv <= 0) continue;

    const delta = approxDelta(opt.spotPrice, opt.strike, T, riskFreeRate, iv, opt.type);

    grid.push({
      strike: opt.strike,
      expiry: opt.expiry,
      iv,
      delta,
    });

    strikeSet.add(opt.strike);
    expirySet.add(opt.expiry);
  }

  const strikes = Array.from(strikeSet).sort((a, b) => a - b);
  const expirations = Array.from(expirySet).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  return { grid, strikes, expirations };
}

/**
 * Analyze the volatility skew for a specific expiration.
 *
 * Computes ATM IV, 25-delta put/call skew, risk reversal, butterfly spread,
 * and a linear skew slope across strikes.
 */
export function analyzeSkew(
  surface: VolSurface,
  expiration: string,
  spotPrice: number
): SkewAnalysis {
  const slice = surface.grid.filter((p) => p.expiry === expiration);

  if (slice.length === 0) {
    return {
      skewType: 'negative',
      putSkew25d: 0,
      callSkew25d: 0,
      riskReversal: 0,
      butterfly: 0,
      skewSlope: 0,
      interpretation: 'No data available for this expiration.',
    };
  }

  // ATM IV: strike nearest to spot
  const atm = slice.reduce((best, p) =>
    Math.abs(p.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? p : best
  );
  const atmIV = atm.iv;

  // 25-delta approximations: ~5% OTM from spot
  const putStrikeTarget = spotPrice * 0.95;
  const callStrikeTarget = spotPrice * 1.05;

  const putSide = slice.reduce((best, p) =>
    Math.abs(p.strike - putStrikeTarget) < Math.abs(best.strike - putStrikeTarget) ? p : best
  );
  const callSide = slice.reduce((best, p) =>
    Math.abs(p.strike - callStrikeTarget) < Math.abs(best.strike - callStrikeTarget) ? p : best
  );

  const putSkew25d = putSide.iv - atmIV;
  const callSkew25d = callSide.iv - atmIV;
  const riskReversal = callSide.iv - putSide.iv;
  const butterfly = 0.5 * (putSide.iv + callSide.iv) - atmIV;

  // Linear skew slope: regression of IV on moneyness (K/S)
  const skewSlope = computeSkewSlope(slice, spotPrice);

  // Classify skew shape
  let skewType: 'negative' | 'positive' | 'smile';
  if (putSkew25d > 0.005 && callSkew25d > 0.005) {
    skewType = 'smile';
  } else if (putSkew25d > callSkew25d) {
    skewType = 'negative';
  } else {
    skewType = 'positive';
  }

  // Generate interpretation
  let interpretation: string;
  switch (skewType) {
    case 'negative':
      interpretation =
        'Negative skew detected — downside protection is relatively expensive. ' +
        'This is typical of equity markets where crash risk is priced in. ' +
        `Risk reversal of ${(riskReversal * 100).toFixed(1)}% favors puts over calls.`;
      break;
    case 'positive':
      interpretation =
        'Positive skew detected — upside calls are relatively expensive. ' +
        'This may indicate speculative demand or takeover premium. ' +
        `Risk reversal of ${(riskReversal * 100).toFixed(1)}% favors calls over puts.`;
      break;
    case 'smile':
      interpretation =
        'Volatility smile detected — both wings are elevated relative to ATM. ' +
        'This suggests heightened tail-risk pricing on both sides. ' +
        `Butterfly spread of ${(butterfly * 100).toFixed(1)}% indicates wing premium.`;
      break;
  }

  return {
    skewType,
    putSkew25d,
    callSkew25d,
    riskReversal,
    butterfly,
    skewSlope,
    interpretation,
  };
}

/** Least-squares slope of IV vs. moneyness (K/S). */
function computeSkewSlope(slice: VolSurfacePoint[], spotPrice: number): number {
  const n = slice.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const p of slice) {
    const x = p.strike / spotPrice; // moneyness
    const y = p.iv;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Extract ATM term structure from the volatility surface.
 *
 * For each expiration, finds the strike nearest to spot and returns
 * its IV. Classifies the curve shape as contango, backwardation, or flat.
 */
export function termStructure(
  surface: VolSurface,
  spotPrice: number
): TermStructure {
  const points: { expiry: string; iv: number }[] = [];

  for (const exp of surface.expirations) {
    const slice = surface.grid.filter((p) => p.expiry === exp);
    if (slice.length === 0) continue;

    const atm = slice.reduce((best, p) =>
      Math.abs(p.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? p : best
    );
    points.push({ expiry: exp, iv: atm.iv });
  }

  // Determine shape
  let shape: 'contango' | 'backwardation' | 'flat' = 'flat';

  if (points.length >= 2) {
    const front = points[0].iv;
    const back = points[points.length - 1].iv;
    const diff = back - front;
    const threshold = 0.005; // 0.5% IV threshold for flat

    if (diff > threshold) {
      shape = 'contango';
    } else if (diff < -threshold) {
      shape = 'backwardation';
    }
  }

  return { points, shape };
}

/**
 * Compare a current vol surface against a historical baseline
 * and flag mispricings where the IV deviation exceeds a threshold.
 *
 * @param current   Live volatility surface
 * @param historical Baseline/historical volatility surface
 * @param threshold  Minimum IV deviation to flag (default 0.05 = 5 IV points)
 * @returns Array of mispriced options sorted by absolute edge descending
 */
export function findMispricing(
  current: VolSurface,
  historical: VolSurface,
  threshold: number = 0.05
): Mispricing[] {
  const mispricings: Mispricing[] = [];

  // Index historical surface by strike|expiry for O(1) lookup
  const histMap = new Map<string, number>();
  for (const p of historical.grid) {
    const key = `${p.strike}|${p.expiry}`;
    histMap.set(key, p.iv);
  }

  for (const p of current.grid) {
    const key = `${p.strike}|${p.expiry}`;
    const histIV = histMap.get(key);
    if (histIV === undefined) continue;

    const edge = p.iv - histIV;
    if (Math.abs(edge) < threshold) continue;

    const direction: 'overpriced' | 'underpriced' = edge > 0 ? 'overpriced' : 'underpriced';
    const type: 'call' | 'put' = p.strike >= (p.delta !== undefined && p.delta > 0 ? 0 : 0)
      ? 'call'
      : 'put';

    // Infer type from delta if available, otherwise default based on convention
    const inferredType: 'call' | 'put' =
      p.delta !== undefined ? (p.delta >= 0 ? 'call' : 'put') : 'call';

    mispricings.push({
      strike: p.strike,
      expiry: p.expiry,
      type: inferredType,
      currentIV: p.iv,
      expectedIV: histIV,
      edge: Math.abs(edge),
      direction,
    });
  }

  // Sort by largest edge first
  mispricings.sort((a, b) => b.edge - a.edge);

  return mispricings;
}
