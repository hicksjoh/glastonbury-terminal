// Options Trading Type Definitions

export interface OptionChainEntry {
  symbol: string;           // OCC symbol e.g. AAPL260418C00190000
  underlying: string;
  expiration: string;       // ISO date
  strike: number;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  inTheMoney: boolean;
}

export interface OptionLeg {
  action: 'buy_to_open' | 'sell_to_open' | 'buy_to_close' | 'sell_to_close';
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  quantity: number;
  premium?: number;
  symbol?: string; // OCC symbol
}

export interface StrategyTemplate {
  name: string;
  slug: string;
  legs: StrategyLegTemplate[];
  maxProfit: string;
  maxLoss: string;
  breakEven: string;
  idealIV: 'high' | 'low' | 'neutral';
  idealOutlook: 'bullish' | 'bearish' | 'neutral' | 'volatile';
  description: string;
  category: 'income' | 'directional' | 'hedging' | 'volatility';
}

export interface StrategyLegTemplate {
  action: 'buy' | 'sell';
  type: 'call' | 'put' | 'stock';
  strikeOffset: number; // Relative to ATM: 0 = ATM, +5 = 5 above, -5 = 5 below
  quantityRatio: number;
  expirationOffset?: number; // Days offset from primary expiration (for calendars)
}

export interface BuiltStrategy {
  template: string;
  underlying: string;
  legs: OptionLeg[];
  maxProfit: number | null;
  maxLoss: number | null;
  breakEven: number[];
  netPremium: number;
  capitalRequired: number;
}

export interface GreeksResult {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface IVData {
  ivRank: number;
  ivPercentile: number;
  currentIV: number;
  iv52High: number;
  iv52Low: number;
  hv30: number;
}

export interface OptionsOrder {
  symbol: string;       // OCC option symbol
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
  stop_price?: number;
}

export interface MultiLegOrder {
  order_class: 'mleg';
  legs: {
    symbol: string;
    side: 'buy' | 'sell';
    ratio_qty: number;
  }[];
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
}

export interface ParsedOCCSymbol {
  underlying: string;
  expiry: string;       // YYYY-MM-DD
  type: 'call' | 'put';
  strike: number;
}

export interface OptionPosition {
  id: string;
  underlying: string;
  optionSymbol: string;
  contractType: 'call' | 'put';
  strike: number;
  expiration: string;
  direction: 'long' | 'short';
  quantity: number;
  avgCost: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  dte: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  strategyId?: string;
}

export interface PortfolioGreeks {
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  sharesEquivalent: number;
  monthlyTheta: number;
}
