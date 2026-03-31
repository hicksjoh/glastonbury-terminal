/**
 * Kelly Criterion Position Sizer
 * Calculates optimal position sizing based on expected edge and volatility
 */

export interface KellyInput {
  expectedReturn: number; // Expected return per trade (e.g., 0.05 = 5%)
  winRate: number; // Historical win rate (0-1)
  avgWin: number; // Average winning trade return (positive)
  avgLoss: number; // Average losing trade return (positive, will be treated as loss)
  volatility?: number; // Annualized volatility (optional, for continuous Kelly)
  riskFreeRate?: number; // Risk-free rate (default 5%)
}

export interface KellyResult {
  fullKelly: number; // Optimal fraction (0-1)
  halfKelly: number;
  quarterKelly: number;
  dollarsAtRisk: number; // Given a portfolio size
  maxLoss: number; // Expected max loss at this size
  recommendation: string;
}

/**
 * Classic Kelly Criterion: f* = (bp - q) / b
 * where b = odds (avg win / avg loss), p = win prob, q = lose prob
 */
export function calculateKelly(input: KellyInput, portfolioSize: number = 100000): KellyResult {
  const { winRate, avgWin, avgLoss } = input;
  const p = Math.max(0.01, Math.min(0.99, winRate));
  const q = 1 - p;
  const b = avgLoss > 0 ? avgWin / avgLoss : 1;

  // Kelly formula
  const fullKelly = Math.max(0, (b * p - q) / b);

  // Cap at 25% for safety
  const cappedKelly = Math.min(fullKelly, 0.25);

  const halfKelly = cappedKelly / 2;
  const quarterKelly = cappedKelly / 4;
  const dollarsAtRisk = portfolioSize * halfKelly;
  const maxLoss = dollarsAtRisk * avgLoss;

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

  return {
    fullKelly: cappedKelly,
    halfKelly,
    quarterKelly,
    dollarsAtRisk,
    maxLoss,
    recommendation,
  };
}

/**
 * Continuous Kelly for long positions: f* = (mu - r) / sigma^2
 * More appropriate for portfolio allocation
 */
export function continuousKelly(
  expectedReturn: number,
  volatility: number,
  riskFreeRate: number = 0.05,
): number {
  if (volatility <= 0) return 0;
  const kelly = (expectedReturn - riskFreeRate) / (volatility * volatility);
  return Math.max(0, Math.min(kelly, 1));
}

/**
 * Options-specific Kelly using historical setup win rates
 */
export function optionsKelly(
  premium: number,
  maxLoss: number,
  winRate: number,
): KellyResult {
  return calculateKelly({
    expectedReturn: premium / maxLoss,
    winRate,
    avgWin: premium,
    avgLoss: maxLoss,
  });
}
