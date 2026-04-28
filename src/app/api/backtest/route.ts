import { NextResponse } from 'next/server';
import { getHistoricalPrices } from '@/lib/fmp-client';

// ── Types ──────────────────────────────────────────────────────────
interface BacktestRequest {
  symbol: string;
  strategy: string;
  period: string;
  positionSize: number;
}

interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FMPHistoricalResponse {
  symbol: string;
  historical: HistoricalPrice[];
}

interface Trade {
  date: string;
  action: 'BUY' | 'SELL';
  price: number;
  pnl: number;
  shares: number;
}

interface EquityPoint {
  date: string;
  value: number;
}

interface BacktestResult {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: number;
  tradeLog: Trade[];
  equityCurve: EquityPoint[];
  message?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function sma(prices: number[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < window - 1) {
      result.push(null);
    } else {
      const slice = prices.slice(i - window + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / window);
    }
  }
  return result;
}

function periodToDays(period: string): number {
  switch (period) {
    case '6m': return 126;
    case '1y': return 252;
    case '2y': return 504;
    case '5y': return 1260;
    default: return 252;
  }
}

function periodToYears(period: string): number {
  switch (period) {
    case '6m': return 0.5;
    case '1y': return 1;
    case '2y': return 2;
    case '5y': return 5;
    default: return 1;
  }
}

function computeMetrics(
  equityCurve: EquityPoint[],
  tradeLog: Trade[],
  years: number,
): Omit<BacktestResult, 'message'> {
  const startVal = equityCurve[0]?.value ?? 10000;
  const endVal = equityCurve[equityCurve.length - 1]?.value ?? startVal;

  const totalReturn = ((endVal - startVal) / startVal) * 100;
  const cagr = (Math.pow(endVal / startVal, 1 / Math.max(years, 0.25)) - 1) * 100;

  // Daily returns for Sharpe / Sortino
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    if (prev > 0) {
      dailyReturns.push((equityCurve[i].value - prev) / prev);
    }
  }

  const meanReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  const downside = dailyReturns.filter(r => r < 0);
  const downsideVariance = downside.length > 1
    ? downside.reduce((s, r) => s + r ** 2, 0) / (downside.length - 1)
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);

  const annualizedSharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;
  const annualizedSortino = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = equityCurve[0]?.value ?? 0;
  let maxDrawdown = 0;
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value;
    const dd = ((pt.value - peak) / peak) * 100;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  // Win / Loss stats
  const closedTrades = tradeLog.filter(t => t.action === 'SELL');
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  const avgWin = wins.length > 0
    ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length
    : 0;

  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  return {
    totalReturn,
    cagr,
    sharpe: annualizedSharpe,
    sortino: annualizedSortino,
    maxDrawdown,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    trades: closedTrades.length,
    tradeLog,
    equityCurve,
  };
}

// ── Strategy Implementations ───────────────────────────────────────

function runMomentum(
  data: HistoricalPrice[],
  startingCapital: number,
): { tradeLog: Trade[]; equityCurve: EquityPoint[] } {
  const closes = data.map(d => d.close);
  const sma50 = sma(closes, 50);

  const tradeLog: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let cash = startingCapital;
  let shares = 0;
  let entryPrice = 0;

  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const avg = sma50[i];

    if (avg !== null) {
      // Buy signal: price crosses above SMA
      if (shares === 0 && price > avg) {
        shares = Math.floor(cash / price);
        if (shares > 0) {
          entryPrice = price;
          cash -= shares * price;
          tradeLog.push({ date: data[i].date, action: 'BUY', price, pnl: 0, shares });
        }
      }
      // Sell signal: price crosses below SMA
      else if (shares > 0 && price < avg) {
        const pnl = (price - entryPrice) * shares;
        cash += shares * price;
        tradeLog.push({ date: data[i].date, action: 'SELL', price, pnl, shares });
        shares = 0;
      }
    }

    const portfolioValue = cash + shares * price;
    equityCurve.push({ date: data[i].date, value: portfolioValue });
  }

  // Close open position at end
  if (shares > 0) {
    const lastPrice = data[data.length - 1].close;
    const pnl = (lastPrice - entryPrice) * shares;
    cash += shares * lastPrice;
    tradeLog.push({ date: data[data.length - 1].date, action: 'SELL', price: lastPrice, pnl, shares });
    shares = 0;
    equityCurve[equityCurve.length - 1].value = cash;
  }

  return { tradeLog, equityCurve };
}

function runDipBuy(
  data: HistoricalPrice[],
  startingCapital: number,
): { tradeLog: Trade[]; equityCurve: EquityPoint[] } {
  const closes = data.map(d => d.close);
  const sma50 = sma(closes, 50);

  const tradeLog: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let cash = startingCapital;
  let shares = 0;
  let entryPrice = 0;

  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const avg = sma50[i];

    if (avg !== null) {
      const dipThreshold = avg * 0.95; // 5% below SMA

      // Buy when price dips 5% below 50-day SMA
      if (shares === 0 && price <= dipThreshold) {
        shares = Math.floor(cash / price);
        if (shares > 0) {
          entryPrice = price;
          cash -= shares * price;
          tradeLog.push({ date: data[i].date, action: 'BUY', price, pnl: 0, shares });
        }
      }
      // Sell when price recovers back above SMA
      else if (shares > 0 && price >= avg) {
        const pnl = (price - entryPrice) * shares;
        cash += shares * price;
        tradeLog.push({ date: data[i].date, action: 'SELL', price, pnl, shares });
        shares = 0;
      }
    }

    const portfolioValue = cash + shares * price;
    equityCurve.push({ date: data[i].date, value: portfolioValue });
  }

  // Close open position
  if (shares > 0) {
    const lastPrice = data[data.length - 1].close;
    const pnl = (lastPrice - entryPrice) * shares;
    cash += shares * lastPrice;
    tradeLog.push({ date: data[data.length - 1].date, action: 'SELL', price: lastPrice, pnl, shares });
    equityCurve[equityCurve.length - 1].value = cash;
  }

  return { tradeLog, equityCurve };
}

function runCoveredCallWheel(
  data: HistoricalPrice[],
  startingCapital: number,
): { tradeLog: Trade[]; equityCurve: EquityPoint[] } {
  // Simulate: buy stock, collect ~1% monthly premium (30-delta call)
  // If stock drops >10%, sell and wait. Re-enter on recovery.
  const tradeLog: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let cash = startingCapital;
  let shares = 0;
  let entryPrice = 0;
  let lastPremiumMonth = -1;

  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const currentMonth = new Date(data[i].date).getMonth();

    // Enter position if not holding
    if (shares === 0) {
      shares = Math.floor(cash / price);
      if (shares > 0) {
        entryPrice = price;
        cash -= shares * price;
        tradeLog.push({ date: data[i].date, action: 'BUY', price, pnl: 0, shares });
      }
    }

    // Collect monthly call premium (~1% of position value for 30-delta)
    if (shares > 0 && currentMonth !== lastPremiumMonth) {
      const premium = shares * price * 0.01;
      cash += premium;
      lastPremiumMonth = currentMonth;
    }

    // Stop loss: exit if down >10% from entry
    if (shares > 0 && price < entryPrice * 0.9) {
      const pnl = (price - entryPrice) * shares;
      cash += shares * price;
      tradeLog.push({ date: data[i].date, action: 'SELL', price, pnl, shares });
      shares = 0;
    }

    const portfolioValue = cash + shares * price;
    equityCurve.push({ date: data[i].date, value: portfolioValue });
  }

  // Close open position
  if (shares > 0) {
    const lastPrice = data[data.length - 1].close;
    const pnl = (lastPrice - entryPrice) * shares;
    cash += shares * lastPrice;
    tradeLog.push({ date: data[data.length - 1].date, action: 'SELL', price: lastPrice, pnl, shares });
    equityCurve[equityCurve.length - 1].value = cash;
  }

  return { tradeLog, equityCurve };
}

function runBuyAndHold(
  data: HistoricalPrice[],
  startingCapital: number,
): { tradeLog: Trade[]; equityCurve: EquityPoint[] } {
  const tradeLog: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  const firstPrice = data[0].close;
  const shares = Math.floor(startingCapital / firstPrice);
  const cash = startingCapital - shares * firstPrice;

  tradeLog.push({ date: data[0].date, action: 'BUY', price: firstPrice, pnl: 0, shares });

  for (const bar of data) {
    equityCurve.push({ date: bar.date, value: cash + shares * bar.close });
  }

  const lastPrice = data[data.length - 1].close;
  const pnl = (lastPrice - firstPrice) * shares;
  tradeLog.push({ date: data[data.length - 1].date, action: 'SELL', price: lastPrice, pnl, shares });

  return { tradeLog, equityCurve };
}

// ── POST handler ───────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BacktestRequest;
    const { symbol, strategy, period, positionSize } = body;

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey || apiKey === 'your_fmp_key_here') {
      return NextResponse.json(
        { error: 'FMP API key required. Set FMP_API_KEY in .env.local' },
        { status: 500 },
      );
    }

    // Earnings straddle can't be simulated with just price data
    if (strategy === 'earnings_straddle') {
      return NextResponse.json(
        {
          error:
            'Earnings Straddle requires options chain and earnings calendar data that is not available from the historical price endpoint. Use the Options Sim page for straddle analysis.',
        },
        { status: 400 },
      );
    }

    // Fetch historical data via /stable client (full OHLCV with change pct).
    const fmpData = await getHistoricalPrices(symbol.toUpperCase(), { light: false });

    if (!fmpData) {
      return NextResponse.json(
        { error: `FMP API failed for ${symbol}` },
        { status: 502 },
      );
    }

    if (!fmpData.historical || fmpData.historical.length === 0) {
      return NextResponse.json(
        { error: `No historical data found for ${symbol.toUpperCase()}` },
        { status: 404 },
      );
    }

    // FMP returns newest first — reverse to chronological
    const allData = [...fmpData.historical].reverse();

    // Trim to requested period
    const days = periodToDays(period);
    const data = allData.slice(-Math.min(days + 60, allData.length)); // extra 60 for SMA warm-up

    if (data.length < 60) {
      return NextResponse.json(
        { error: `Not enough data for ${symbol.toUpperCase()} (need at least 60 trading days)` },
        { status: 400 },
      );
    }

    const startingCapital = 10000 * (positionSize / 100);
    const years = periodToYears(period);

    let result: { tradeLog: Trade[]; equityCurve: EquityPoint[] };

    switch (strategy) {
      case 'momentum':
        result = runMomentum(data, startingCapital);
        break;
      case 'dip_buy':
        result = runDipBuy(data, startingCapital);
        break;
      case 'wheel':
        result = runCoveredCallWheel(data, startingCapital);
        break;
      case 'custom':
      default:
        result = runBuyAndHold(data, startingCapital);
        break;
    }

    // Thin out equity curve if too many points (keep ~120 max for charting)
    let equityCurve = result.equityCurve;
    if (equityCurve.length > 120) {
      const step = Math.ceil(equityCurve.length / 120);
      const thinned: EquityPoint[] = [];
      for (let i = 0; i < equityCurve.length; i += step) {
        thinned.push(equityCurve[i]);
      }
      // Always include the last point
      if (thinned[thinned.length - 1]?.date !== equityCurve[equityCurve.length - 1]?.date) {
        thinned.push(equityCurve[equityCurve.length - 1]);
      }
      equityCurve = thinned;
    }

    const metrics = computeMetrics(equityCurve, result.tradeLog, years);

    const response: BacktestResult = {
      ...metrics,
      equityCurve,
      message: strategy === 'custom' ? 'Showing buy-and-hold returns for Custom strategy.' : undefined,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
