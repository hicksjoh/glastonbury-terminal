// Options Strategy Templates & Builders
import type { StrategyTemplate, BuiltStrategy, OptionLeg } from './types';
import { buildOCCSymbol } from './symbols';

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  // === INCOME STRATEGIES ===
  {
    name: 'Covered Call',
    slug: 'covered-call',
    legs: [
      { action: 'sell', type: 'call', strikeOffset: 5, quantityRatio: 1 },
    ],
    maxProfit: 'Premium + (Strike - Current Price) if called away',
    maxLoss: 'Stock drops to $0 minus premium received',
    breakEven: 'Stock purchase price - premium received',
    idealIV: 'high',
    idealOutlook: 'neutral',
    description: 'Own 100 shares, sell a call. Collect premium for capped upside.',
    category: 'income',
  },
  {
    name: 'Cash-Secured Put',
    slug: 'cash-secured-put',
    legs: [
      { action: 'sell', type: 'put', strikeOffset: -5, quantityRatio: 1 },
    ],
    maxProfit: 'Premium received',
    maxLoss: 'Strike price - premium (if stock goes to $0)',
    breakEven: 'Strike price - premium received',
    idealIV: 'high',
    idealOutlook: 'neutral',
    description: 'Sell a put with cash to cover assignment. Collect premium or buy stock at discount.',
    category: 'income',
  },

  // === DIRECTIONAL STRATEGIES ===
  {
    name: 'Bull Call Spread',
    slug: 'bull-call-spread',
    legs: [
      { action: 'buy', type: 'call', strikeOffset: 0, quantityRatio: 1 },
      { action: 'sell', type: 'call', strikeOffset: 5, quantityRatio: 1 },
    ],
    maxProfit: 'Width of strikes - net debit',
    maxLoss: 'Net debit paid',
    breakEven: 'Lower strike + net debit',
    idealIV: 'low',
    idealOutlook: 'bullish',
    description: 'Buy a call, sell a higher call. Limited risk bullish bet.',
    category: 'directional',
  },
  {
    name: 'Bear Put Spread',
    slug: 'bear-put-spread',
    legs: [
      { action: 'buy', type: 'put', strikeOffset: 0, quantityRatio: 1 },
      { action: 'sell', type: 'put', strikeOffset: -5, quantityRatio: 1 },
    ],
    maxProfit: 'Width of strikes - net debit',
    maxLoss: 'Net debit paid',
    breakEven: 'Higher strike - net debit',
    idealIV: 'low',
    idealOutlook: 'bearish',
    description: 'Buy a put, sell a lower put. Limited risk bearish bet.',
    category: 'directional',
  },
  {
    name: 'Bull Put Spread',
    slug: 'bull-put-spread',
    legs: [
      { action: 'sell', type: 'put', strikeOffset: -2, quantityRatio: 1 },
      { action: 'buy', type: 'put', strikeOffset: -7, quantityRatio: 1 },
    ],
    maxProfit: 'Net credit received',
    maxLoss: 'Width of strikes - net credit',
    breakEven: 'Short strike - net credit',
    idealIV: 'high',
    idealOutlook: 'bullish',
    description: 'Sell a put, buy a lower put. Collect credit if stock stays above short strike.',
    category: 'directional',
  },
  {
    name: 'Bear Call Spread',
    slug: 'bear-call-spread',
    legs: [
      { action: 'sell', type: 'call', strikeOffset: 2, quantityRatio: 1 },
      { action: 'buy', type: 'call', strikeOffset: 7, quantityRatio: 1 },
    ],
    maxProfit: 'Net credit received',
    maxLoss: 'Width of strikes - net credit',
    breakEven: 'Short strike + net credit',
    idealIV: 'high',
    idealOutlook: 'bearish',
    description: 'Sell a call, buy a higher call. Collect credit if stock stays below short strike.',
    category: 'directional',
  },

  // === VOLATILITY STRATEGIES ===
  {
    name: 'Iron Condor',
    slug: 'iron-condor',
    legs: [
      { action: 'sell', type: 'put', strikeOffset: -5, quantityRatio: 1 },
      { action: 'buy', type: 'put', strikeOffset: -10, quantityRatio: 1 },
      { action: 'sell', type: 'call', strikeOffset: 5, quantityRatio: 1 },
      { action: 'buy', type: 'call', strikeOffset: 10, quantityRatio: 1 },
    ],
    maxProfit: 'Net credit received',
    maxLoss: 'Width of one spread - net credit',
    breakEven: 'Short put - credit / Short call + credit',
    idealIV: 'high',
    idealOutlook: 'neutral',
    description: 'Sell OTM put spread + OTM call spread. Profit if stock stays in range.',
    category: 'income',
  },
  {
    name: 'Iron Butterfly',
    slug: 'iron-butterfly',
    legs: [
      { action: 'sell', type: 'put', strikeOffset: 0, quantityRatio: 1 },
      { action: 'buy', type: 'put', strikeOffset: -5, quantityRatio: 1 },
      { action: 'sell', type: 'call', strikeOffset: 0, quantityRatio: 1 },
      { action: 'buy', type: 'call', strikeOffset: 5, quantityRatio: 1 },
    ],
    maxProfit: 'Net credit received',
    maxLoss: 'Width of one spread - net credit',
    breakEven: 'ATM strike ± net credit',
    idealIV: 'high',
    idealOutlook: 'neutral',
    description: 'Sell ATM straddle + buy OTM wings. Higher premium than condor, tighter range.',
    category: 'income',
  },
  {
    name: 'Long Straddle',
    slug: 'long-straddle',
    legs: [
      { action: 'buy', type: 'call', strikeOffset: 0, quantityRatio: 1 },
      { action: 'buy', type: 'put', strikeOffset: 0, quantityRatio: 1 },
    ],
    maxProfit: 'Unlimited (up) / Strike - premium (down)',
    maxLoss: 'Total premium paid',
    breakEven: 'Strike ± total premium',
    idealIV: 'low',
    idealOutlook: 'volatile',
    description: 'Buy ATM call + put. Profit from big moves in either direction.',
    category: 'volatility',
  },
  {
    name: 'Long Strangle',
    slug: 'long-strangle',
    legs: [
      { action: 'buy', type: 'call', strikeOffset: 5, quantityRatio: 1 },
      { action: 'buy', type: 'put', strikeOffset: -5, quantityRatio: 1 },
    ],
    maxProfit: 'Unlimited (up) / Strike - premium (down)',
    maxLoss: 'Total premium paid',
    breakEven: 'Call strike + premium / Put strike - premium',
    idealIV: 'low',
    idealOutlook: 'volatile',
    description: 'Buy OTM call + OTM put. Cheaper than straddle, needs bigger move.',
    category: 'volatility',
  },

  // === HEDGING STRATEGIES ===
  {
    name: 'Protective Put',
    slug: 'protective-put',
    legs: [
      { action: 'buy', type: 'put', strikeOffset: -5, quantityRatio: 1 },
    ],
    maxProfit: 'Unlimited (stock appreciation minus premium)',
    maxLoss: 'Current price - strike + premium',
    breakEven: 'Current stock price + premium paid',
    idealIV: 'low',
    idealOutlook: 'bullish',
    description: 'Own stock + buy put. Insurance against drops.',
    category: 'hedging',
  },
  {
    name: 'Collar',
    slug: 'collar',
    legs: [
      { action: 'buy', type: 'put', strikeOffset: -5, quantityRatio: 1 },
      { action: 'sell', type: 'call', strikeOffset: 5, quantityRatio: 1 },
    ],
    maxProfit: 'Call strike - current price + net credit/debit',
    maxLoss: 'Current price - put strike + net credit/debit',
    breakEven: 'Current price + net debit (or - net credit)',
    idealIV: 'neutral',
    idealOutlook: 'neutral',
    description: 'Own stock + buy put + sell call. Zero-cost hedge with capped upside.',
    category: 'hedging',
  },
  {
    name: 'PMCC (Poor Man\'s Covered Call)',
    slug: 'pmcc',
    legs: [
      { action: 'buy', type: 'call', strikeOffset: -15, quantityRatio: 1, expirationOffset: 90 },
      { action: 'sell', type: 'call', strikeOffset: 5, quantityRatio: 1 },
    ],
    maxProfit: 'Short strike - long strike - net debit + short premium',
    maxLoss: 'Net debit paid',
    breakEven: 'Long strike + net debit',
    idealIV: 'neutral',
    idealOutlook: 'bullish',
    description: 'Buy deep ITM LEAPS call, sell short-term OTM call. Covered call without owning shares.',
    category: 'income',
  },
  {
    name: 'Calendar Spread',
    slug: 'calendar-spread',
    legs: [
      { action: 'sell', type: 'call', strikeOffset: 0, quantityRatio: 1 },
      { action: 'buy', type: 'call', strikeOffset: 0, quantityRatio: 1, expirationOffset: 30 },
    ],
    maxProfit: 'Difference in time value at front expiration',
    maxLoss: 'Net debit paid',
    breakEven: 'Depends on IV — calculated at entry',
    idealIV: 'low',
    idealOutlook: 'neutral',
    description: 'Sell near-term call, buy same-strike longer-term call. Profit from time decay differential.',
    category: 'volatility',
  },
];

/**
 * Round to nearest standard strike (e.g., $1, $2.50, $5, $10 increments)
 */
function roundToStrike(price: number): number {
  if (price < 25) return Math.round(price * 2) / 2;    // $0.50 increments
  if (price < 100) return Math.round(price);             // $1 increments
  if (price < 250) return Math.round(price / 2.5) * 2.5; // $2.50 increments
  return Math.round(price / 5) * 5;                      // $5 increments
}

/**
 * Build a concrete strategy from a template
 */
export function buildStrategy(
  template: StrategyTemplate,
  underlying: string,
  currentPrice: number,
  expiration: string,
  premiumEstimates?: Map<string, number> // OCC symbol → estimated premium
): BuiltStrategy {
  const atmStrike = roundToStrike(currentPrice);

  const legs: OptionLeg[] = template.legs.map(legTemplate => {
    if (legTemplate.type === 'stock') {
      return {
        action: legTemplate.action === 'buy' ? 'buy_to_open' : 'sell_to_open',
        type: 'call' as const, // placeholder
        strike: currentPrice,
        expiration,
        quantity: legTemplate.quantityRatio * 100, // 100 shares per contract
      };
    }

    const strike = roundToStrike(atmStrike + legTemplate.strikeOffset);
    const legExp = legTemplate.expirationOffset
      ? addDays(expiration, legTemplate.expirationOffset)
      : expiration;

    const action = legTemplate.action === 'buy' ? 'buy_to_open' : 'sell_to_open';
    const occSymbol = buildOCCSymbol(underlying, legExp, legTemplate.type as 'call' | 'put', strike);

    return {
      action: action as OptionLeg['action'],
      type: legTemplate.type as 'call' | 'put',
      strike,
      expiration: legExp,
      quantity: legTemplate.quantityRatio,
      premium: premiumEstimates?.get(occSymbol) ?? 0,
      symbol: occSymbol,
    };
  });

  // Calculate net premium (positive = credit, negative = debit)
  let netPremium = 0;
  for (const leg of legs) {
    const prem = (leg.premium ?? 0) * leg.quantity * 100;
    if (leg.action === 'sell_to_open') {
      netPremium += prem;
    } else {
      netPremium -= prem;
    }
  }

  return {
    template: template.slug,
    underlying,
    legs,
    maxProfit: null, // Calculated dynamically from payoff diagram
    maxLoss: null,
    breakEven: [],
    netPremium,
    capitalRequired: Math.abs(netPremium), // Simplified — real margin calc is more complex
  };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function getTemplateBySlug(slug: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find(t => t.slug === slug);
}

export function getTemplatesByCategory(category: StrategyTemplate['category']): StrategyTemplate[] {
  return STRATEGY_TEMPLATES.filter(t => t.category === category);
}
