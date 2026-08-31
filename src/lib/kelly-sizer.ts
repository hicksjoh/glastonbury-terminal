/**
 * Kelly Criterion Position Sizer
 * Calculates optimal position sizing based on expected edge and volatility
 *
 * SAFETY CONTRACT
 * ---------------
 * This module feeds the autopilot (src/app/api/autopilot/route.ts), the
 * trade guard (src/lib/trade-guard-engine.ts) and the signal scorer. Its
 * inputs are derived from broker/historical APIs, so a missing or
 * malformed upstream field is a realistic input — not a theoretical one.
 *
 * It therefore FAILS CLOSED: any non-finite or out-of-domain input
 * yields a zero-size result and an explicit "insufficient data"
 * recommendation. It never emits NaN, never emits a number it cannot
 * justify, and never routes garbage to the "strong edge" branch.
 */

import { allFinite } from './finite';

/** Hard safety cap on the recommended fraction of capital per trade. */
export const MAX_KELLY_FRACTION = 0.25;

/** Emitted verbatim whenever the inputs cannot support a sizing decision. */
export const INSUFFICIENT_DATA_RECOMMENDATION =
  'Insufficient or invalid data — cannot size this trade. No position recommended.';

export interface KellyInput {
  /** Historical win rate, as a FRACTION in [0, 1]. 0.55, not 55. */
  winRate: number;
  /** Average winning trade return (positive, as a fraction). */
  avgWin: number;
  /** Average losing trade return (positive magnitude, as a fraction). */
  avgLoss: number;
}

export interface KellyResult {
  /**
   * The true, UNCAPPED Kelly fraction f* = (bp - q) / b, floored at 0.
   * This is the edge measurement; it is NOT a position size. Anything
   * sizing a real order must use `cappedKelly` or below.
   */
  fullKelly: number;
  /** `fullKelly` after the MAX_KELLY_FRACTION safety cap. The largest size this module will ever endorse. */
  cappedKelly: number;
  /** cappedKelly / 2 — the standard recommendation. */
  halfKelly: number;
  /** cappedKelly / 4 — for marginal edges. */
  quarterKelly: number;
  /** portfolioSize x halfKelly. */
  dollarsAtRisk: number;
  /** Expected loss at half-Kelly size if the trade goes against us. */
  maxLoss: number;
  recommendation: string;
}

function insufficientData(): KellyResult {
  return {
    fullKelly: 0,
    cappedKelly: 0,
    halfKelly: 0,
    quarterKelly: 0,
    dollarsAtRisk: 0,
    maxLoss: 0,
    recommendation: INSUFFICIENT_DATA_RECOMMENDATION,
  };
}

/**
 * Classic Kelly Criterion: f* = (bp - q) / b
 * where b = odds (avg win / avg loss), p = win prob, q = lose prob
 *
 * Fails closed (zero size, "insufficient data") when:
 *   - any input is NaN or +/-Infinity
 *   - winRate is outside [0, 1] (a caller passing a percent is malformed
 *     data, not a 99% win rate — clamping it would invent an edge)
 *   - avgLoss <= 0 (undefined odds; the old code silently used b = 1)
 *   - avgWin < 0
 *   - portfolioSize < 0
 */
export function calculateKelly(input: KellyInput, portfolioSize: number = 100000): KellyResult {
  const { winRate, avgWin, avgLoss } = input;

  // --- Fail closed on anything we cannot reason about -------------------
  // Do this BEFORE any arithmetic: NaN survives Math.max/Math.min and
  // then passes every subsequent `<` / `<=` guard as false.
  if (!allFinite(winRate, avgWin, avgLoss, portfolioSize)) return insufficientData();
  if (winRate < 0 || winRate > 1) return insufficientData();
  if (avgLoss <= 0) return insufficientData();
  if (avgWin < 0) return insufficientData();
  if (portfolioSize < 0) return insufficientData();

  const p = winRate;
  const q = 1 - p;
  const b = avgWin / avgLoss;

  // avgWin === 0 means no upside at all: b === 0 and the formula divides
  // by zero. The economically correct answer is "no position".
  const fullKelly = b > 0 ? Math.max(0, (b * p - q) / b) : 0;

  const cappedKelly = Math.min(fullKelly, MAX_KELLY_FRACTION);
  const halfKelly = cappedKelly / 2;
  const quarterKelly = cappedKelly / 4;
  const dollarsAtRisk = portfolioSize * halfKelly;
  const maxLoss = dollarsAtRisk * avgLoss;

  // Branch on the same number the caller reads back as `fullKelly`.
  let recommendation: string;
  if (fullKelly <= 0) {
    recommendation = 'Negative edge detected — do not take this trade.';
  } else if (fullKelly < 0.05) {
    recommendation = `Marginal edge. Quarter-Kelly (${(quarterKelly * 100).toFixed(1)}%) recommended for small position.`;
  } else if (fullKelly < 0.15) {
    recommendation = `Moderate edge. Half-Kelly (${(halfKelly * 100).toFixed(1)}%) is the standard recommendation.`;
  } else {
    recommendation = `Strong edge detected. Half-Kelly (${(halfKelly * 100).toFixed(1)}%) to manage tail risk.`;
  }

  return { fullKelly, cappedKelly, halfKelly, quarterKelly, dollarsAtRisk, maxLoss, recommendation };
}

/**
 * Continuous Kelly for long positions: f* = (mu - r) / sigma^2
 * More appropriate for portfolio allocation. Returns 0 (no position)
 * for any non-finite input or non-positive volatility.
 */
export function continuousKelly(
  expectedReturn: number,
  volatility: number,
  riskFreeRate: number = 0.05,
): number {
  if (!allFinite(expectedReturn, volatility, riskFreeRate)) return 0;
  if (volatility <= 0) return 0;
  const kelly = (expectedReturn - riskFreeRate) / (volatility * volatility);
  if (!Number.isFinite(kelly)) return 0;
  return Math.max(0, Math.min(kelly, 1));
}

/**
 * Options-specific Kelly using historical setup win rates.
 * `maxLoss` is the debit at risk; `premium` is the credit/profit target.
 */
export function optionsKelly(
  premium: number,
  maxLoss: number,
  winRate: number,
): KellyResult {
  return calculateKelly({
    winRate,
    avgWin: premium,
    avgLoss: maxLoss,
  });
}
