/**
 * Scanner evidence: what a signal card is allowed to claim.
 *
 * Every tag here is a fact the scanner actually fetched. The previous scorer
 * was fed proxies — a price change stood in for "bullish flow", "positive
 * sentiment" and "above 50DMA", and `regimeFit` was the literal `true` — so a
 * +683% penny stock showed four independent-looking confirmations and a
 * Kelly-sized "Buy 1785 shares" off an invented 55% win rate and a hardcoded
 * $100,000 portfolio (QA 2026-10-05, blocker 5).
 *
 * The scanner has no measured edge for these screens, so it emits no position
 * size. Sizing belongs to the trade guard, which reads the real account.
 */

export interface MoverFacts {
  price: number;
  /** Day change in percent, e.g. 4.2 for +4.2%. */
  change: number;
  isGainer: boolean;
  isActive: boolean;
  insiderBuy: boolean;
}

export const MIN_SCAN_PRICE = 5;
export const MAX_SCAN_DAY_CHANGE_PCT = 50;

/** Sub-$5 names and >50% single-day spikes are halts, reverse splits and
 *  low-float squeezes: not a momentum signal a confluence screen should rank. */
export function isScannableMover(f: Pick<MoverFacts, 'price' | 'change'>): boolean {
  return (
    Number.isFinite(f.price) &&
    Number.isFinite(f.change) &&
    f.price >= MIN_SCAN_PRICE &&
    Math.abs(f.change) <= MAX_SCAN_DAY_CHANGE_PCT
  );
}

const CONFLUENCE_WEIGHTS = { top_gainer: 30, most_active: 30, insider_buy: 40 } as const;

export function confluenceEvidence(f: MoverFacts): { score: number; sources: string[] } {
  const sources: string[] = [];
  if (f.isGainer) sources.push('top_gainer');
  if (f.isActive) sources.push('most_active');
  if (f.insiderBuy) sources.push('insider_buy');
  const score = sources.reduce(
    (sum, s) => sum + CONFLUENCE_WEIGHTS[s as keyof typeof CONFLUENCE_WEIGHTS],
    0,
  );
  return { score, sources };
}

/** A long-biased screen "fits" only a regime that was actually classified bull. */
export function longSignalFitsRegime(regime: string): boolean {
  return regime === 'bull_low_vol' || regime === 'bull_high_vol';
}
