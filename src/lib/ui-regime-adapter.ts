// ─── Regime-Aware UI Adaptation ─────────────────────────────────────────────
// Adjusts dashboard behavior and appearance based on market regime.

export type MarketRegime =
  | 'trending_bull'
  | 'trending_bear'
  | 'mean_reverting'
  | 'high_volatility'
  | 'low_volatility';

export interface RegimeUIConfig {
  regime: MarketRegime;
  label: string;
  dashboardWidgetOrder: string[];
  suppressedSignals: string[];
  boostedSignals: string[];
  alertSeverityBoost: number;
  positionSizeMultiplier: number;
  suggestedStrategies: string[];
  warningMessage: string | null;
  bgTint: string | null;
  borderTint: string | null;
}

const CONFIGS: Record<MarketRegime, Omit<RegimeUIConfig, 'regime'>> = {
  trending_bull: {
    label: 'Trending Bull',
    dashboardWidgetOrder: ['narrative', 'kpi', 'positions', 'movers', 'briefing', 'wealth', 'activity'],
    suppressedSignals: ['mean_reversion', 'short_setup'],
    boostedSignals: ['momentum', 'breakout', 'trend_following'],
    alertSeverityBoost: 0,
    positionSizeMultiplier: 1.0,
    suggestedStrategies: ['Trend following', 'Breakout entries', 'Trailing stops', 'Covered calls on winners'],
    warningMessage: null,
    bgTint: null,
    borderTint: 'rgba(74,222,128,0.15)',
  },
  trending_bear: {
    label: 'Trending Bear',
    dashboardWidgetOrder: ['narrative', 'kpi', 'positions', 'briefing', 'movers', 'wealth', 'activity'],
    suppressedSignals: ['momentum_buy', 'breakout_long'],
    boostedSignals: ['put_flow', 'hedge_signal', 'defensive'],
    alertSeverityBoost: 1,
    positionSizeMultiplier: 0.8,
    suggestedStrategies: ['Put spreads', 'Hedging positions', 'Short premium', 'Cash preservation'],
    warningMessage: 'Bear trend detected — protect capital. Consider reducing exposure.',
    bgTint: null,
    borderTint: 'rgba(248,113,113,0.12)',
  },
  mean_reverting: {
    label: 'Mean Reverting',
    dashboardWidgetOrder: ['narrative', 'kpi', 'positions', 'movers', 'briefing', 'wealth', 'activity'],
    suppressedSignals: ['breakout', 'trend_following'],
    boostedSignals: ['support_resistance', 'oversold', 'overbought'],
    alertSeverityBoost: 0,
    positionSizeMultiplier: 1.0,
    suggestedStrategies: ['Iron condors', 'Range trading', 'Selling premium', 'Mean reversion entries'],
    warningMessage: null,
    bgTint: null,
    borderTint: null,
  },
  high_volatility: {
    label: 'High Volatility',
    dashboardWidgetOrder: ['narrative', 'kpi', 'positions', 'briefing', 'movers', 'wealth', 'activity'],
    suppressedSignals: ['low_conviction', 'noise'],
    boostedSignals: ['high_conviction', 'vol_play', 'hedge'],
    alertSeverityBoost: 1,
    positionSizeMultiplier: 0.5,
    suggestedStrategies: ['Straddles', 'Strangles', 'Reduced position size', 'Cash is a position'],
    warningMessage: 'High volatility — reduce position sizes 50%. Only high-conviction trades.',
    bgTint: 'rgba(251,191,36,0.02)',
    borderTint: 'rgba(251,191,36,0.15)',
  },
  low_volatility: {
    label: 'Low Volatility',
    dashboardWidgetOrder: ['narrative', 'kpi', 'positions', 'movers', 'briefing', 'wealth', 'activity'],
    suppressedSignals: ['vol_play', 'straddle'],
    boostedSignals: ['earnings_play', 'premium_selling', 'calendar'],
    alertSeverityBoost: 0,
    positionSizeMultiplier: 1.2,
    suggestedStrategies: ['Premium selling', 'Calendar spreads', 'Earnings plays', 'Slightly larger size OK'],
    warningMessage: null,
    bgTint: null,
    borderTint: null,
  },
};

export function getRegimeUIConfig(regime: MarketRegime): RegimeUIConfig {
  const config = CONFIGS[regime] || CONFIGS.mean_reverting;
  return { regime, ...config };
}

/**
 * Map API regime strings (bull_low_vol etc.) to our UI regime types.
 */
export function mapApiRegime(apiRegime: string): MarketRegime {
  switch (apiRegime) {
    case 'bull_low_vol': return 'trending_bull';
    case 'bull_high_vol': return 'high_volatility';
    case 'bear_low_vol': return 'mean_reverting';
    case 'bear_high_vol': return 'trending_bear';
    default: return 'mean_reverting';
  }
}

/**
 * Format the regime config for Keisha AI context string.
 */
export function regimeContextString(config: RegimeUIConfig): string {
  const lines = [
    `Current regime: ${config.label} (size multiplier: ${config.positionSizeMultiplier}x)`,
    `Suggested strategies: ${config.suggestedStrategies.join(', ')}`,
    `Boosted signals: ${config.boostedSignals.join(', ')}`,
  ];
  if (config.warningMessage) lines.push(`WARNING: ${config.warningMessage}`);
  return lines.join('\n');
}
