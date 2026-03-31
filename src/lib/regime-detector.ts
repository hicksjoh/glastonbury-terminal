/**
 * Market Regime Detection — 4-state HMM-inspired model
 * States: bull_low_vol, bull_high_vol, bear_low_vol, bear_high_vol
 */

export type RegimeState = 'bull_low_vol' | 'bull_high_vol' | 'bear_low_vol' | 'bear_high_vol';

export interface RegimeResult {
  regime: RegimeState;
  confidence: number;
  factors: {
    vix: number | null;
    vixRatio: number | null;
    yieldSpread: number | null;
    momentum: number | null;
  };
}

// Transition probabilities (simplified)
const TRANSITION_MATRIX: Record<RegimeState, Record<RegimeState, number>> = {
  bull_low_vol: { bull_low_vol: 0.80, bull_high_vol: 0.10, bear_low_vol: 0.08, bear_high_vol: 0.02 },
  bull_high_vol: { bull_low_vol: 0.25, bull_high_vol: 0.50, bear_low_vol: 0.10, bear_high_vol: 0.15 },
  bear_low_vol: { bull_low_vol: 0.20, bull_high_vol: 0.10, bear_low_vol: 0.55, bear_high_vol: 0.15 },
  bear_high_vol: { bull_low_vol: 0.05, bull_high_vol: 0.15, bear_low_vol: 0.10, bear_high_vol: 0.70 },
};

export function detectRegime(
  vix: number | null,
  vixRatio: number | null, // VIX3M / VIX
  yieldSpread: number | null, // 2s10s
  momentum: number | null, // SPY % change
): RegimeResult {
  const v = vix ?? 20;
  const m = momentum ?? 0;
  const ratio = vixRatio ?? 1.0;
  const spread = yieldSpread ?? 0.5;

  // Score each regime based on observed data
  const scores: Record<RegimeState, number> = {
    bull_low_vol: 0,
    bull_high_vol: 0,
    bear_low_vol: 0,
    bear_high_vol: 0,
  };

  // VIX scoring
  if (v < 15) { scores.bull_low_vol += 3; scores.bear_low_vol += 1; }
  else if (v < 20) { scores.bull_low_vol += 2; scores.bear_low_vol += 1; }
  else if (v < 25) { scores.bull_high_vol += 2; scores.bear_low_vol += 1; }
  else if (v < 30) { scores.bull_high_vol += 1; scores.bear_high_vol += 2; }
  else { scores.bear_high_vol += 3; }

  // Momentum scoring
  if (m > 1) { scores.bull_low_vol += 2; scores.bull_high_vol += 1; }
  else if (m > 0) { scores.bull_low_vol += 1; scores.bull_high_vol += 1; }
  else if (m > -1) { scores.bear_low_vol += 1; scores.bear_high_vol += 1; }
  else { scores.bear_low_vol += 1; scores.bear_high_vol += 2; }

  // VIX term structure (ratio > 1 = contango = calm, < 1 = backwardation = fear)
  if (ratio > 1.05) { scores.bull_low_vol += 2; }
  else if (ratio > 0.95) { scores.bull_low_vol += 1; scores.bear_low_vol += 1; }
  else { scores.bear_high_vol += 2; }

  // Yield spread (positive = normal, negative/flat = recession risk)
  if (spread > 0.5) { scores.bull_low_vol += 1; }
  else if (spread > 0) { scores.bull_high_vol += 1; }
  else { scores.bear_high_vol += 1; scores.bear_low_vol += 1; }

  // Find max score
  const entries = Object.entries(scores) as [RegimeState, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const regime = entries[0][0];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);
  const confidence = totalScore > 0 ? entries[0][1] / totalScore : 0.25;

  return {
    regime,
    confidence: Math.min(0.95, confidence),
    factors: { vix, vixRatio, yieldSpread, momentum },
  };
}

export function getRegimeLabel(regime: RegimeState): string {
  const labels: Record<RegimeState, string> = {
    bull_low_vol: 'BULL · LOW VOL',
    bull_high_vol: 'BULL · HIGH VOL',
    bear_low_vol: 'BEAR · LOW VOL',
    bear_high_vol: 'BEAR · HIGH VOL',
  };
  return labels[regime];
}

export function getRegimeColor(regime: RegimeState): string {
  const colors: Record<RegimeState, string> = {
    bull_low_vol: '#4ade80',
    bull_high_vol: '#f0c674',
    bear_low_vol: '#f0c674',
    bear_high_vol: '#f87171',
  };
  return colors[regime];
}

export function getRegimeAdvice(regime: RegimeState): string {
  const advice: Record<RegimeState, string> = {
    bull_low_vol: 'Optimal for selling premium (covered calls, cash-secured puts). Low IV makes buying options cheap. Consider increasing equity exposure.',
    bull_high_vol: 'Good premium selling environment but watch for mean reversion. Keep position sizes moderate. Consider protective puts.',
    bear_low_vol: 'Grinding lower with low urgency. Good environment for accumulating quality names on dips. Consider collar strategies.',
    bear_high_vol: 'Crisis mode — stay defensive. Reduce leverage, increase cash. Premium selling is lucrative but risky. Focus on capital preservation.',
  };
  return advice[regime];
}
