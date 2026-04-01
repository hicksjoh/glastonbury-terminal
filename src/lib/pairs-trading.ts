// ─── Statistical Arbitrage Engine ────────────────────────────────────────────
// Pure TypeScript pairs-trading toolkit. No external dependencies.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CointegrationResult {
  isCointegrated: boolean;
  pValue: number;
  halfLife: number;
  hedgeRatio: number;
}

export interface SpreadData {
  spread: number[];
  mean: number;
  std: number;
  zScore: number;
  current: number;
}

export interface PairsConfig {
  entryZ: number;
  exitZ: number;
  stopZ: number;
  lookback: number;
}

export interface PairsSignal {
  action: 'enter_long_A_short_B' | 'enter_short_A_long_B' | 'exit' | 'stop_loss' | 'hold';
}

export interface PairCandidate {
  symbolA: string;
  symbolB: string;
  correlation: number;
  cointegrationPValue: number;
  halfLife: number;
  zScore: number;
  signal: PairsSignal;
  hedgeRatio: number;
}

export interface BacktestResult {
  trades: number;
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  pnl: number;
  equityCurve: number[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PairsConfig = {
  entryZ: 2.0,
  exitZ: 0.5,
  stopZ: 3.5,
  lookback: 60,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function stdDev(arr: number[], mu?: number): number {
  const m = mu ?? mean(arr);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (arr.length - 1));
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Ordinary Least Squares: y = alpha + beta * x
 * Returns { alpha, beta, residuals }.
 */
function ols(y: number[], x: number[]): { alpha: number; beta: number; residuals: number[] } {
  const n = y.length;
  const mx = mean(x);
  const my = mean(y);
  let ssxy = 0;
  let ssxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    ssxy += dx * (y[i] - my);
    ssxx += dx * dx;
  }
  const beta = ssxx === 0 ? 0 : ssxy / ssxx;
  const alpha = my - beta * mx;
  const residuals: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = y[i] - (alpha + beta * x[i]);
  }
  return { alpha, beta, residuals };
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Test cointegration between two price series via a simplified ADF test.
 *
 * 1. OLS: pricesA = hedgeRatio * pricesB + residual
 * 2. ADF on the residuals: regress delta(spread) on lag(spread)
 * 3. Compare t-stat to ADF critical values.
 * 4. Derive half-life from mean-reversion coefficient.
 */
export function testCointegration(pricesA: number[], pricesB: number[]): CointegrationResult {
  const n = Math.min(pricesA.length, pricesB.length);
  if (n < 10) {
    return { isCointegrated: false, pValue: 1, halfLife: Infinity, hedgeRatio: 0 };
  }

  const a = pricesA.slice(0, n);
  const b = pricesB.slice(0, n);

  // Step 1: OLS regression  pricesA = hedgeRatio * pricesB + residual
  const { beta: hedgeRatio, residuals: spread } = ols(a, b);

  // Step 2: ADF on spread — regress delta(spread) on lag(spread)
  const dSpread: number[] = new Array(spread.length - 1);
  const lagSpread: number[] = new Array(spread.length - 1);
  for (let i = 1; i < spread.length; i++) {
    dSpread[i - 1] = spread[i] - spread[i - 1];
    lagSpread[i - 1] = spread[i - 1];
  }

  // OLS: dSpread = gamma * lagSpread  (no intercept for simplicity in ADF)
  const m = dSpread.length;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < m; i++) {
    sumXY += lagSpread[i] * dSpread[i];
    sumXX += lagSpread[i] * lagSpread[i];
  }
  const gamma = sumXX === 0 ? 0 : sumXY / sumXX;

  // Standard error of gamma
  let sse = 0;
  for (let i = 0; i < m; i++) {
    const err = dSpread[i] - gamma * lagSpread[i];
    sse += err * err;
  }
  const sigmaResid = Math.sqrt(sse / (m - 1));
  const seGamma = sumXX === 0 ? Infinity : sigmaResid / Math.sqrt(sumXX);

  // ADF test statistic
  const tStat = seGamma === Infinity || seGamma === 0 ? 0 : gamma / seGamma;

  // Approximate p-value from ADF critical values
  //   1% → -3.43,  5% → -2.86,  10% → -2.57
  let pValue: number;
  if (tStat <= -3.43) {
    pValue = 0.01;
  } else if (tStat <= -2.86) {
    // Linearly interpolate between 1% and 5%
    pValue = 0.01 + ((tStat - -3.43) / (-2.86 - -3.43)) * (0.05 - 0.01);
  } else if (tStat <= -2.57) {
    // Linearly interpolate between 5% and 10%
    pValue = 0.05 + ((tStat - -2.86) / (-2.57 - -2.86)) * (0.10 - 0.05);
  } else if (tStat <= -1.94) {
    // Extrapolate towards ~25%
    pValue = 0.10 + ((tStat - -2.57) / (-1.94 - -2.57)) * (0.25 - 0.10);
  } else {
    // Not stationary
    pValue = Math.min(1, 0.25 + (tStat + 1.94) * 0.5);
  }
  pValue = Math.max(0.001, Math.min(1, pValue));

  // Half-life: halfLife = -ln(2) / ln(1 + gamma)
  let halfLife: number;
  if (gamma >= 0 || gamma <= -1) {
    halfLife = Infinity; // no mean-reversion
  } else {
    halfLife = -Math.LN2 / Math.log(1 + gamma);
    if (halfLife < 0) halfLife = Infinity;
  }

  const isCointegrated = pValue < 0.05;

  return { isCointegrated, pValue, halfLife, hedgeRatio };
}

/**
 * Compute the spread and its statistics given two price series and a hedge ratio.
 */
export function calculateSpread(
  pricesA: number[],
  pricesB: number[],
  hedgeRatio: number,
): SpreadData {
  const n = Math.min(pricesA.length, pricesB.length);
  const spread: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    spread[i] = pricesA[i] - hedgeRatio * pricesB[i];
  }

  const mu = mean(spread);
  const sigma = stdDev(spread, mu);
  const current = spread[n - 1];
  const zScore = sigma === 0 ? 0 : (current - mu) / sigma;

  return { spread, mean: mu, std: sigma, zScore, current };
}

/**
 * Generate a pairs-trading signal from a z-score.
 */
export function generateSignal(zScore: number, config?: Partial<PairsConfig>): PairsSignal {
  const c = { ...DEFAULT_CONFIG, ...config };
  const absZ = Math.abs(zScore);

  if (absZ > c.stopZ) {
    return { action: 'stop_loss' };
  }
  if (absZ > c.entryZ) {
    // Positive z → A is expensive relative to B → short A, long B
    return {
      action: zScore > 0 ? 'enter_short_A_long_B' : 'enter_long_A_short_B',
    };
  }
  if (absZ < c.exitZ) {
    return { action: 'exit' };
  }
  return { action: 'hold' };
}

/**
 * Scan all unique pairs from a set of symbols, returning candidates sorted
 * by cointegration p-value (best first). Only pairs with pValue < 0.1 pass.
 */
export function scanPairs(
  symbols: string[],
  prices: Map<string, number[]>,
): PairCandidate[] {
  const candidates: PairCandidate[] = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const symA = symbols[i];
      const symB = symbols[j];
      const pA = prices.get(symA);
      const pB = prices.get(symB);
      if (!pA || !pB || pA.length < 10 || pB.length < 10) continue;

      const coint = testCointegration(pA, pB);
      if (coint.pValue >= 0.1) continue;

      const spreadData = calculateSpread(pA, pB, coint.hedgeRatio);
      const correlation = pearsonCorrelation(pA, pB);
      const signal = generateSignal(spreadData.zScore);

      candidates.push({
        symbolA: symA,
        symbolB: symB,
        correlation,
        cointegrationPValue: coint.pValue,
        halfLife: coint.halfLife,
        zScore: spreadData.zScore,
        signal,
        hedgeRatio: coint.hedgeRatio,
      });
    }
  }

  candidates.sort((a, b) => a.cointegrationPValue - b.cointegrationPValue);
  return candidates;
}

/**
 * Walk-forward backtest of a pairs strategy on two price series.
 * Returns trade stats, Sharpe, max drawdown, and an equity curve.
 */
export function backtestPair(
  pricesA: number[],
  pricesB: number[],
  config?: Partial<PairsConfig>,
): BacktestResult {
  const c = { ...DEFAULT_CONFIG, ...config };
  const n = Math.min(pricesA.length, pricesB.length);

  if (n < c.lookback + 2) {
    return { trades: 0, winRate: 0, sharpe: 0, maxDrawdown: 0, pnl: 0, equityCurve: [] };
  }

  // State
  let position: 'none' | 'long_A_short_B' | 'short_A_long_B' = 'none';
  let entrySpread = 0;
  let entryHedgeRatio = 0;

  const trades: number[] = []; // per-trade P&L
  const equityCurve: number[] = [];
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (let t = c.lookback; t < n; t++) {
    // Rolling window for hedge ratio and spread stats
    const windowA = pricesA.slice(t - c.lookback, t + 1);
    const windowB = pricesB.slice(t - c.lookback, t + 1);

    const { beta: hr, residuals } = ols(windowA, windowB);
    const mu = mean(residuals);
    const sigma = stdDev(residuals, mu);
    const currentSpread = pricesA[t] - hr * pricesB[t];
    const z = sigma === 0 ? 0 : (currentSpread - mu) / sigma;

    const signal = generateSignal(z, c);

    if (position === 'none') {
      if (signal.action === 'enter_long_A_short_B' || signal.action === 'enter_short_A_long_B') {
        position = signal.action === 'enter_long_A_short_B' ? 'long_A_short_B' : 'short_A_long_B';
        entrySpread = currentSpread;
        entryHedgeRatio = hr;
      }
    } else {
      if (signal.action === 'exit' || signal.action === 'stop_loss') {
        // Close position — P&L is change in spread (direction-adjusted)
        const spreadChange = currentSpread - entrySpread;
        const tradePnL = position === 'long_A_short_B' ? spreadChange : -spreadChange;
        trades.push(tradePnL);
        equity += tradePnL;
        position = 'none';
      }
    }

    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Close any remaining open position at the end
  if (position !== 'none') {
    const finalSpread = pricesA[n - 1] - entryHedgeRatio * pricesB[n - 1];
    const spreadChange = finalSpread - entrySpread;
    const tradePnL = position === 'long_A_short_B' ? spreadChange : -spreadChange;
    trades.push(tradePnL);
    equity += tradePnL;
    equityCurve[equityCurve.length - 1] = equity;
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t > 0).length;
  const winRate = totalTrades === 0 ? 0 : wins / totalTrades;

  // Sharpe ratio (annualized, assuming daily returns on equity curve)
  let sharpe = 0;
  if (equityCurve.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push(equityCurve[i] - equityCurve[i - 1]);
    }
    const avgReturn = mean(returns);
    const stdReturn = stdDev(returns, avgReturn);
    sharpe = stdReturn === 0 ? 0 : (avgReturn / stdReturn) * Math.sqrt(252);
  }

  return {
    trades: totalTrades,
    winRate,
    sharpe,
    maxDrawdown,
    pnl: equity,
    equityCurve,
  };
}
