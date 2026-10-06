/**
 * One VIX + SPY-momentum regime classifier for every surface that prints a
 * regime label. The header chip (/api/regime) and the scanner used to run two
 * unrelated classifiers and disagreed on the same screen (QA 2026-10-05).
 */
export type MarketRegime =
  | 'bull_low_vol'
  | 'bull_high_vol'
  | 'bear_low_vol'
  | 'bear_high_vol'
  | 'unknown';

/** A missing input is 'unknown'. It is never defaulted to a number: VIX 20 /
 *  momentum 0 used to classify an outage as a confident bear market. */
export function classifyRegime(
  vix: number | null | undefined,
  momentumPct: number | null | undefined,
): { regime: MarketRegime; confidence: number } {
  if (!Number.isFinite(vix) || !Number.isFinite(momentumPct)) {
    return { regime: 'unknown', confidence: 0 };
  }
  const v = vix as number;
  const m = momentumPct as number;

  if (v < 20 && m > 0) return { regime: 'bull_low_vol', confidence: 0.75 + Math.min(0.2, (20 - v) / 100) };
  if (v >= 20 && m > 0) return { regime: 'bull_high_vol', confidence: 0.6 };
  if (v < 20 && m <= 0) return { regime: 'bear_low_vol', confidence: 0.55 };
  return { regime: 'bear_high_vol', confidence: 0.7 + Math.min(0.2, Math.max(0, v - 30) / 100) };
}
