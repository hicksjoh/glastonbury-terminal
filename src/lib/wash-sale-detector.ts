// ============================================================
// WASH SALE DETECTOR
// IRS §1091 — 61-day window (30 before + sell day + 30 after)
// ============================================================

import { ACTIVE_TAX_YEAR, TAX_DISCLAIMER } from './tax-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  date: string; // ISO date string
  isSection1256?: boolean;
  isMTM475?: boolean;
}

export interface WashSaleCheck {
  ticker: string;
  sellDate: Date;
  sellPrice: number;
  sellQuantity: number;
  realizedLoss: number;
  costBasis: number;
}

export interface WashSaleResult {
  isWashSale: boolean;
  ticker: string;
  reason: string;
  conflictingTrade?: {
    date: string;
    action: 'buy' | 'sell';
    quantity: number;
    price: number;
  };
  disallowedLoss: number;
  adjustedCostBasis: number;
  windowStart: string;
  windowEnd: string;
  disclaimer: string;
}

export interface WashSaleAlert {
  type: 'pre_trade_warning' | 'post_trade_flag' | 'upcoming_window_close';
  severity: 'critical' | 'warning' | 'info';
  ticker: string;
  message: string;
  details: WashSaleResult;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

const HALF_WINDOW = 30; // 30 days each side of the sell date

// ─── Core Detection ─────────────────────────────────────────────────────────

/**
 * Check if a specific loss-sale triggers a wash sale.
 * Looks 30 days before AND 30 days after the sell date for any buy of the same ticker.
 */
export function checkWashSale(
  trade: WashSaleCheck,
  tradeHistory: TradeRecord[],
): WashSaleResult {
  const sellDate = new Date(trade.sellDate);
  const windowStart = addDays(sellDate, -HALF_WINDOW);
  const windowEnd = addDays(sellDate, HALF_WINDOW);

  const baseResult: WashSaleResult = {
    isWashSale: false,
    ticker: trade.ticker,
    reason: 'No conflicting purchases found within the 61-day wash sale window.',
    disallowedLoss: 0,
    adjustedCostBasis: 0,
    windowStart: toISO(windowStart),
    windowEnd: toISO(windowEnd),
    disclaimer: TAX_DISCLAIMER,
  };

  // Only losses can trigger wash sales
  if (trade.realizedLoss >= 0) {
    baseResult.reason = 'Gain on sale — wash sale rules only apply to losses.';
    return baseResult;
  }

  // Find conflicting buys in the 61-day window (same ticker)
  const conflicting = tradeHistory
    .filter(t => {
      if (t.ticker.toUpperCase() !== trade.ticker.toUpperCase()) return false;
      if (t.action !== 'buy') return false;
      // Skip Section 1256 and MTM 475 — exempt from wash sales
      if (t.isSection1256 || t.isMTM475) return false;
      const tDate = new Date(t.date);
      return tDate >= windowStart && tDate <= windowEnd;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (conflicting.length === 0) {
    return baseResult;
  }

  // The closest conflicting buy
  const conflict = conflicting[0];
  const conflictDate = new Date(conflict.date);
  const isBefore = conflictDate < sellDate;

  // Calculate disallowed loss (proportional to replacement shares)
  const replacementQty = Math.min(conflict.quantity, trade.sellQuantity);
  const proportionReplaced = replacementQty / trade.sellQuantity;
  const disallowedLoss = Math.round(Math.abs(trade.realizedLoss) * proportionReplaced * 100) / 100;

  // Adjusted cost basis = replacement buy price + disallowed loss per share
  const disallowedPerShare = disallowedLoss / replacementQty;
  const adjustedCostBasis = Math.round((conflict.price + disallowedPerShare) * 100) / 100;

  return {
    isWashSale: true,
    ticker: trade.ticker,
    reason: isBefore
      ? `You purchased ${conflict.quantity} shares of ${trade.ticker} on ${toISO(conflictDate)} (${daysBetween(conflictDate, sellDate)} days before this sale). This triggers a wash sale under IRS §1091.`
      : `You purchased ${conflict.quantity} shares of ${trade.ticker} on ${toISO(conflictDate)} (${daysBetween(sellDate, conflictDate)} days after this sale). This triggers a wash sale under IRS §1091.`,
    conflictingTrade: {
      date: toISO(conflictDate),
      action: conflict.action,
      quantity: conflict.quantity,
      price: conflict.price,
    },
    disallowedLoss,
    adjustedCostBasis,
    windowStart: toISO(windowStart),
    windowEnd: toISO(windowEnd),
    disclaimer: TAX_DISCLAIMER,
  };
}

/**
 * Scan ALL realized losses in trade history for wash sale violations.
 * Returns alerts sorted by severity.
 */
export function scanPortfolioForWashSales(trades: TradeRecord[]): WashSaleAlert[] {
  const alerts: WashSaleAlert[] = [];

  // Find all sells
  const sells = trades.filter(t => t.action === 'sell' && !t.isSection1256 && !t.isMTM475);

  for (const sell of sells) {
    // We need to estimate cost basis — look for the most recent buy before this sell
    const priorBuys = trades
      .filter(t => t.ticker === sell.ticker && t.action === 'buy' && new Date(t.date) <= new Date(sell.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const costBasis = priorBuys.length > 0 ? priorBuys[0].price : sell.price;
    const realizedLoss = (sell.price - costBasis) * sell.quantity;

    if (realizedLoss >= 0) continue; // Only check losses

    const check: WashSaleCheck = {
      ticker: sell.ticker,
      sellDate: new Date(sell.date),
      sellPrice: sell.price,
      sellQuantity: sell.quantity,
      realizedLoss,
      costBasis,
    };

    const result = checkWashSale(check, trades);
    if (result.isWashSale) {
      alerts.push({
        type: 'post_trade_flag',
        severity: 'critical',
        ticker: sell.ticker,
        message: `Wash sale detected: ${sell.ticker} sold at loss on ${sell.date}, conflicting buy on ${result.conflictingTrade?.date}. Disallowed loss: $${result.disallowedLoss.toLocaleString()}.`,
        details: result,
      });
    }
  }

  // Sort: critical first
  alerts.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity];
  });

  return alerts;
}

/**
 * PRE-TRADE check: "If I buy/sell this NOW, will it trigger a wash sale?"
 */
export function getWashSalePreview(
  ticker: string,
  action: 'buy' | 'sell',
  tradeHistory: TradeRecord[],
  currentPrice?: number,
): WashSaleAlert | null {
  const now = new Date();
  const windowStart = addDays(now, -HALF_WINDOW);
  const windowEnd = addDays(now, HALF_WINDOW);
  const tickerUpper = ticker.toUpperCase();

  if (action === 'sell') {
    // Selling at a loss? Check if there were recent buys within 30 days before
    const recentBuys = tradeHistory.filter(t =>
      t.ticker.toUpperCase() === tickerUpper &&
      t.action === 'buy' &&
      !t.isSection1256 && !t.isMTM475 &&
      new Date(t.date) >= windowStart &&
      new Date(t.date) <= now,
    );

    if (recentBuys.length > 0) {
      const latestBuy = recentBuys.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      return {
        type: 'pre_trade_warning',
        severity: 'critical',
        ticker: tickerUpper,
        message: `Selling ${tickerUpper} at a loss now may trigger a wash sale — you bought ${latestBuy.quantity} shares on ${latestBuy.date} (within 30 days). The loss would be DISALLOWED and added to your replacement cost basis.`,
        details: {
          isWashSale: true,
          ticker: tickerUpper,
          reason: `Recent buy on ${latestBuy.date} falls within 30-day pre-sale window.`,
          conflictingTrade: {
            date: latestBuy.date,
            action: 'buy',
            quantity: latestBuy.quantity,
            price: latestBuy.price,
          },
          disallowedLoss: 0, // Can't calculate exact loss without knowing cost basis
          adjustedCostBasis: 0,
          windowStart: toISO(windowStart),
          windowEnd: toISO(windowEnd),
          disclaimer: TAX_DISCLAIMER,
        },
      };
    }
  }

  if (action === 'buy') {
    // Buying? Check if there were recent loss-sales within 30 days before
    const recentSells = tradeHistory.filter(t =>
      t.ticker.toUpperCase() === tickerUpper &&
      t.action === 'sell' &&
      !t.isSection1256 && !t.isMTM475 &&
      new Date(t.date) >= windowStart &&
      new Date(t.date) <= now,
    );

    for (const sell of recentSells) {
      // Was the sell at a loss? Estimate from the closest preceding buy
      const precedingBuys = tradeHistory
        .filter(t => t.ticker.toUpperCase() === tickerUpper && t.action === 'buy' && new Date(t.date) < new Date(sell.date))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const estimatedBasis = precedingBuys.length > 0 ? precedingBuys[0].price : 0;
      if (estimatedBasis > 0 && sell.price < estimatedBasis) {
        return {
          type: 'pre_trade_warning',
          severity: 'warning',
          ticker: tickerUpper,
          message: `Buying ${tickerUpper} now may trigger a wash sale — you sold at a loss on ${sell.date} (within 30 days). The disallowed loss would be added to your new cost basis.`,
          details: {
            isWashSale: true,
            ticker: tickerUpper,
            reason: `Recent loss-sale on ${sell.date} falls within 30-day post-sale window.`,
            conflictingTrade: {
              date: sell.date,
              action: 'sell',
              quantity: sell.quantity,
              price: sell.price,
            },
            disallowedLoss: Math.round((estimatedBasis - sell.price) * sell.quantity * 100) / 100,
            adjustedCostBasis: currentPrice ? Math.round((currentPrice + ((estimatedBasis - sell.price))) * 100) / 100 : 0,
            windowStart: toISO(windowStart),
            windowEnd: toISO(windowEnd),
            disclaimer: TAX_DISCLAIMER,
          },
        };
      }
    }
  }

  return null;
}

/**
 * Find losses where the 30-day post-sale window is about to close (< 5 days).
 * These are "safe to rebuy" alerts.
 */
export function getUpcomingWindowCloses(trades: TradeRecord[]): WashSaleAlert[] {
  const now = new Date();
  const alerts: WashSaleAlert[] = [];

  const lossSells = trades.filter(t => t.action === 'sell' && !t.isSection1256 && !t.isMTM475);

  for (const sell of lossSells) {
    // Estimate if it was a loss
    const precedingBuys = trades
      .filter(t => t.ticker === sell.ticker && t.action === 'buy' && new Date(t.date) < new Date(sell.date))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const basis = precedingBuys.length > 0 ? precedingBuys[0].price : 0;
    if (basis <= 0 || sell.price >= basis) continue; // Not a loss

    const sellDate = new Date(sell.date);
    const windowEnd = addDays(sellDate, HALF_WINDOW);
    const daysRemaining = daysBetween(now, windowEnd);

    // Window closing in 1-5 days and still in the future
    if (windowEnd > now && daysRemaining <= 5) {
      alerts.push({
        type: 'upcoming_window_close',
        severity: 'info',
        ticker: sell.ticker,
        message: `Safe to rebuy ${sell.ticker} in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} (${toISO(windowEnd)}). The 30-day post-sale wash sale window is closing.`,
        details: {
          isWashSale: false,
          ticker: sell.ticker,
          reason: `Wash sale window for ${sell.ticker} sale on ${sell.date} closes on ${toISO(windowEnd)}.`,
          disallowedLoss: 0,
          adjustedCostBasis: 0,
          windowStart: toISO(addDays(sellDate, -HALF_WINDOW)),
          windowEnd: toISO(windowEnd),
          disclaimer: TAX_DISCLAIMER,
        },
      });
    }
  }

  return alerts;
}
