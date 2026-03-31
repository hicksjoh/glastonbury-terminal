/**
 * Behavioral Guardrails
 * Detect common behavioral biases and alert without blocking
 */

export type BiasType = 'panic_sell' | 'performance_chase' | 'disposition_effect' | 'overtrading';

export interface BehavioralAlert {
  type: BiasType;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  data: Record<string, unknown>;
  recommendation: string;
}

export interface TradeContext {
  action: 'buy' | 'sell';
  ticker: string;
  quantity: number;
  recentOrderCount5Min?: number;
  vixLevel?: number;
  stockChangeLast5Days?: number;
  wasOnWatchlist?: boolean;
  unrealizedGainPct?: number;
  unrealizedLossPct?: number;
}

export interface PortfolioContext {
  positions: {
    symbol: string;
    unrealizedPlPct: number;
    holdingDays: number;
  }[];
  recentSells: { ticker: string; timestamp: number; reason?: string }[];
}

/**
 * Panic Detection: >3 sell orders within 5 minutes during VIX spike
 */
function checkPanicSelling(trade: TradeContext): BehavioralAlert | null {
  if (trade.action !== 'sell') return null;
  if ((trade.recentOrderCount5Min || 0) < 3) return null;
  if ((trade.vixLevel || 0) < 25) return null;

  return {
    type: 'panic_sell',
    severity: 'critical',
    title: 'Possible Panic Selling Detected',
    message: `You've submitted ${trade.recentOrderCount5Min} sell orders in 5 minutes with VIX at ${trade.vixLevel?.toFixed(1)}. The last 3 times this pattern occurred in markets, selling at the bottom led to 12-15% missed recovery.`,
    data: { orderCount: trade.recentOrderCount5Min, vix: trade.vixLevel },
    recommendation: 'Consider pausing for 30 minutes. If you still want to reduce exposure, use a trailing stop instead of market sells.',
  };
}

/**
 * Performance Chasing: Buying a stock up >20% in last 5 days without prior watchlist
 */
function checkPerformanceChasing(trade: TradeContext): BehavioralAlert | null {
  if (trade.action !== 'buy') return null;
  if ((trade.stockChangeLast5Days || 0) < 20) return null;
  if (trade.wasOnWatchlist) return null;

  return {
    type: 'performance_chase',
    severity: 'warning',
    title: 'Performance Chasing Signal',
    message: `${trade.ticker} is up ${trade.stockChangeLast5Days?.toFixed(1)}% in the last 5 days and wasn't on your watchlist. Historically, buying momentum after a >20% move has a 62% chance of mean reversion within 30 days.`,
    data: { change5d: trade.stockChangeLast5Days, onWatchlist: false },
    recommendation: `If you believe in ${trade.ticker} long-term, add it to your watchlist and wait for a 5-10% pullback. Consider a limit order 5% below current price.`,
  };
}

/**
 * Disposition Effect: Holding winners too long while cutting losers
 */
function checkDispositionEffect(trade: TradeContext, portfolio: PortfolioContext): BehavioralAlert | null {
  if (trade.action !== 'sell') return null;
  if (!trade.unrealizedLossPct || trade.unrealizedLossPct > -10) return null;

  // Check if there are positions with >20% gains being held
  const bigWinners = portfolio.positions.filter(p => p.unrealizedPlPct > 20);
  if (bigWinners.length === 0) return null;

  return {
    type: 'disposition_effect',
    severity: 'warning',
    title: 'Disposition Effect Pattern',
    message: `You're selling ${trade.ticker} at a ${trade.unrealizedLossPct?.toFixed(1)}% loss while holding ${bigWinners.length} position(s) with >20% gains. Research shows this bias costs investors 4-7% annually.`,
    data: { lossTicker: trade.ticker, winnerCount: bigWinners.length, lossPct: trade.unrealizedLossPct },
    recommendation: 'Consider: Is this a tax-loss harvest? If not, evaluate whether the thesis for your winners is still intact — sometimes taking gains and keeping conviction losers is the right move.',
  };
}

/**
 * Main guard function — checks all behavioral patterns
 */
export function checkBehavioralGuards(
  trade: TradeContext,
  portfolio: PortfolioContext,
): BehavioralAlert[] {
  const alerts: BehavioralAlert[] = [];

  const panic = checkPanicSelling(trade);
  if (panic) alerts.push(panic);

  const chase = checkPerformanceChasing(trade);
  if (chase) alerts.push(chase);

  const disposition = checkDispositionEffect(trade, portfolio);
  if (disposition) alerts.push(disposition);

  return alerts;
}
