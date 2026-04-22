/**
 * Trade Guard Engine — shared core logic
 * Used by both /api/trade-guard route and Keisha's check_trade_guard tool
 */

import { checkBehavioralGuards, type TradeContext, type PortfolioContext } from '@/lib/behavioral-guard';
import { calculateKelly, type KellyInput } from '@/lib/kelly-sizer';
import { detectRegime, getRegimeAdvice, getRegimeLabel } from '@/lib/regime-detector';
import { getQuote, getStockPriceChange } from '@/lib/fmp-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradeGuardRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  winRate?: number;
  avgWin?: number;
  avgLoss?: number;
  wasOnWatchlist?: boolean;
}

export interface TradeGuardResult {
  success: true;
  verdict: 'CLEAR' | 'CAUTION' | 'STOP';
  verdictMessage: string;
  behavioral: {
    alerts: Array<{ type: string; severity: string; title: string; message: string; recommendation: string }>;
    alertCount: number;
    hasCritical: boolean;
  };
  sizing: {
    portfolioEquity: number;
    proposedShares: number;
    proposedDollars: number;
    proposedPct: string;
    kelly: {
      recommendation: string;
      fullKellyPct: string;
      halfKellyPct: string;
      halfKellyDollars: number;
      halfKellyShares: number;
      regimeAdjustedPct: string;
      regimeAdjustedDollars: number;
      regimeAdjustedShares: number;
    };
    verdict: string;
    verdictMessage: string;
  };
  regime: {
    state: string;
    label: string;
    confidence: number;
    advice: string;
    vix: number | null;
    regimeMultiplier: number;
  };
  concentration: {
    currentExposure: number;
    afterTradeExposure: number;
    concentrationPct: string;
    warning: string | null;
  };
}

// ─── Alpaca + Market Data Helpers ────────────────────────────────────────────

async function getAlpacaPortfolio() {
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };

  let equity = 100000;
  const positions: { symbol: string; unrealizedPlPct: number; holdingDays: number; marketValue: number; unrealizedPl: number }[] = [];
  const recentSells: { ticker: string; timestamp: number }[] = [];
  let recentOrderCount5Min = 0;

  try {
    const [accountRes, positionsRes, ordersRes] = await Promise.all([
      fetch(`${baseUrl}/v2/account`, { headers }),
      fetch(`${baseUrl}/v2/positions`, { headers }),
      fetch(`${baseUrl}/v2/orders?status=all&limit=50&direction=desc`, { headers }),
    ]);

    if (accountRes.ok) {
      const acct = await accountRes.json();
      equity = parseFloat(acct.equity) || 100000;
    }

    if (positionsRes.ok) {
      const pos = await positionsRes.json();
      for (const p of pos) {
        positions.push({
          symbol: p.symbol,
          unrealizedPlPct: parseFloat(p.unrealized_plpc) * 100,
          holdingDays: Math.floor((Date.now() - new Date(p.created_at || Date.now()).getTime()) / 86400000),
          marketValue: parseFloat(p.market_value),
          unrealizedPl: parseFloat(p.unrealized_pl),
        });
      }
    }

    if (ordersRes.ok) {
      const orders = await ordersRes.json();
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      for (const o of orders) {
        const orderTime = new Date(o.submitted_at).getTime();
        if (orderTime > fiveMinAgo) recentOrderCount5Min++;
        if (o.side === 'sell' && o.status === 'filled') {
          recentSells.push({ ticker: o.symbol, timestamp: orderTime });
        }
      }
    }
  } catch (err) {
    console.error('Trade guard — Alpaca fetch error:', err);
  }

  return { equity, positions, recentSells, recentOrderCount5Min };
}

async function getVIX(): Promise<number | null> {
  const q = await getQuote('^VIX');
  return q?.price ?? null;
}

async function getStockChange5D(symbol: string): Promise<number | null> {
  const change = await getStockPriceChange(symbol);
  return change?.['5D'] ?? null;
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

export async function runTradeGuard(req: TradeGuardRequest): Promise<TradeGuardResult> {
  const { symbol, side, quantity, price } = req;

  const [portfolio, vix, stockChange5D] = await Promise.all([
    getAlpacaPortfolio(),
    getVIX(),
    getStockChange5D(symbol),
  ]);

  const currentPosition = portfolio.positions.find(p => p.symbol === symbol);

  // 1. BEHAVIORAL GUARD
  const tradeContext: TradeContext = {
    action: side,
    ticker: symbol,
    quantity,
    recentOrderCount5Min: portfolio.recentOrderCount5Min,
    vixLevel: vix ?? undefined,
    stockChangeLast5Days: stockChange5D ?? undefined,
    wasOnWatchlist: req.wasOnWatchlist ?? false,
    unrealizedGainPct: currentPosition && currentPosition.unrealizedPlPct > 0 ? currentPosition.unrealizedPlPct : undefined,
    unrealizedLossPct: currentPosition && currentPosition.unrealizedPlPct < 0 ? currentPosition.unrealizedPlPct : undefined,
  };

  const portfolioContext: PortfolioContext = {
    positions: portfolio.positions.map(p => ({
      symbol: p.symbol,
      unrealizedPlPct: p.unrealizedPlPct,
      holdingDays: p.holdingDays,
    })),
    recentSells: portfolio.recentSells.slice(0, 20),
  };

  const behavioralAlerts = checkBehavioralGuards(tradeContext, portfolioContext);

  // 2. KELLY CRITERION SIZING
  const kellyInput: KellyInput = {
    expectedReturn: req.avgWin ? req.avgWin * (req.winRate || 0.5) - (req.avgLoss || 0.05) * (1 - (req.winRate || 0.5)) : 0.03,
    winRate: req.winRate || 0.55,
    avgWin: req.avgWin || 0.08,
    avgLoss: req.avgLoss || 0.05,
  };

  const kelly = calculateKelly(kellyInput, portfolio.equity);
  const proposedDollars = quantity * price;
  const proposedPct = (proposedDollars / portfolio.equity) * 100;
  const kellyDollars = portfolio.equity * kelly.halfKelly;
  const kellyShares = Math.floor(kellyDollars / price);

  let sizingVerdict: 'undersized' | 'optimal' | 'oversized' | 'way_oversized';
  if (proposedPct <= kelly.quarterKelly * 100) sizingVerdict = 'undersized';
  else if (proposedPct <= kelly.halfKelly * 100 * 1.2) sizingVerdict = 'optimal';
  else if (proposedPct <= kelly.fullKelly * 100) sizingVerdict = 'oversized';
  else sizingVerdict = 'way_oversized';

  // 3. REGIME DETECTION
  const regime = detectRegime(vix, null, null, stockChange5D ? stockChange5D / 5 : null);
  const regimeLabel = getRegimeLabel(regime.regime);
  const regimeAdvice = getRegimeAdvice(regime.regime);

  // 4. REGIME-ADJUSTED KELLY
  const regimeMultiplier = { bull_low_vol: 1.0, bull_high_vol: 0.75, bear_low_vol: 0.6, bear_high_vol: 0.4 }[regime.regime];
  const adjustedKellyPct = kelly.halfKelly * regimeMultiplier * 100;
  const adjustedKellyDollars = portfolio.equity * kelly.halfKelly * regimeMultiplier;
  const adjustedKellyShares = Math.floor(adjustedKellyDollars / price);

  // 5. CONCENTRATION CHECK
  const existingExposure = currentPosition ? currentPosition.marketValue : 0;
  const totalExposureAfterTrade = side === 'buy' ? existingExposure + proposedDollars : Math.max(0, existingExposure - proposedDollars);
  const concentrationPct = (totalExposureAfterTrade / portfolio.equity) * 100;
  let concentrationWarning: string | null = null;
  if (concentrationPct > 25) concentrationWarning = `After this trade, ${symbol} would be ${concentrationPct.toFixed(1)}% of your portfolio. Heavy concentration — keep single positions under 20%.`;
  else if (concentrationPct > 15) concentrationWarning = `${symbol} would be ${concentrationPct.toFixed(1)}% of portfolio. Manageable but watch it.`;

  const hasCritical = behavioralAlerts.some(a => a.severity === 'critical');
  const hasWarnings = behavioralAlerts.length > 0;

  return {
    success: true,
    verdict: hasCritical ? 'STOP' : hasWarnings || sizingVerdict === 'way_oversized' ? 'CAUTION' : 'CLEAR',
    verdictMessage: hasCritical
      ? 'Keisha detected a critical behavioral pattern. Review the alerts before proceeding.'
      : hasWarnings ? 'Keisha flagged some concerns. Review and decide.'
      : 'No red flags. Trade looks clean.',
    behavioral: { alerts: behavioralAlerts, alertCount: behavioralAlerts.length, hasCritical },
    sizing: {
      portfolioEquity: portfolio.equity,
      proposedShares: quantity,
      proposedDollars: Math.round(proposedDollars),
      proposedPct: proposedPct.toFixed(1),
      kelly: {
        recommendation: kelly.recommendation,
        fullKellyPct: (kelly.fullKelly * 100).toFixed(1),
        halfKellyPct: (kelly.halfKelly * 100).toFixed(1),
        halfKellyDollars: Math.round(kellyDollars),
        halfKellyShares: kellyShares,
        regimeAdjustedPct: adjustedKellyPct.toFixed(1),
        regimeAdjustedDollars: Math.round(adjustedKellyDollars),
        regimeAdjustedShares: adjustedKellyShares,
      },
      verdict: sizingVerdict,
      verdictMessage: {
        undersized: 'Position is smaller than quarter-Kelly. Room to size up if thesis is strong.',
        optimal: 'Position is in the half-Kelly sweet spot. Solid risk management.',
        oversized: 'Between half and full Kelly. Aggressive but manageable.',
        way_oversized: `Exceeds full Kelly (${(kelly.fullKelly * 100).toFixed(1)}%). Consider reducing to ${adjustedKellyShares} shares ($${Math.round(adjustedKellyDollars).toLocaleString()}).`,
      }[sizingVerdict],
    },
    regime: { state: regime.regime, label: regimeLabel, confidence: regime.confidence, advice: regimeAdvice, vix, regimeMultiplier },
    concentration: { currentExposure: Math.round(existingExposure), afterTradeExposure: Math.round(totalExposureAfterTrade), concentrationPct: concentrationPct.toFixed(1), warning: concentrationWarning },
  };
}
