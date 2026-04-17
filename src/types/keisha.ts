// ─── Keisha AI Type Definitions ─────────────────────────────────────────────

export type ExplanationLevel = 'technical' | 'balanced' | 'plain_talk';

export interface KeishaSettings {
  riskTolerance?: number;
  commStyle?: string;
  paperMode?: boolean;
  explanationLevel?: ExplanationLevel;
}

export type CardType =
  | 'trade' | 'portfolio' | 'options' | 'guard' | 'gex' | 'insider' | 'alert' | 'signal'
  | 'order_ticket' | 'mini_chart' | 'greeks_calc' | 'trade_preview';

export interface RenderCard {
  type: CardType;
  data:
    | TradeCardData | PortfolioCardData | OptionsCardData | GuardCardData | GEXCardData | InsiderCardData
    | OrderTicketCardData | MiniChartCardData | GreeksCalcCardData | TradePreviewCardData;
}

// ─── Phase 9 — MCP-style inline widgets ─────────────────────────────────────
export interface OrderTicketCardData {
  ticker: string;
  side: 'buy' | 'sell';
  qty: number;
  limit: number | null;
  last_price: number | null;
  suggested_sizing: { kellyShares: number | null; halfKellyShares: number | null } | null;
  paperMode: boolean;
}

export interface MiniChartCardData {
  ticker: string;
  timeframe: '1D' | '5D' | '1M' | '3M' | '6M' | '1Y';
  closes: number[];
  last: number;
  change_pct: number;
}

export interface GreeksCalcCardData {
  ticker: string;
  strike: number;
  expiry: string;  // ISO date
  spot: number;
  type: 'call' | 'put';
  iv: number;
  dte: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number; rho: number };
  premium_theoretical: number;
}

export interface TradePreviewLeg {
  action: 'buy' | 'sell';
  type: 'call' | 'put' | 'stock';
  strike?: number;
  expiry?: string;
  qty: number;
  price: number;
}

export interface TradePreviewCardData {
  ticker: string;
  legs: TradePreviewLeg[];
  net_debit_credit: number; // negative = credit, positive = debit
  max_profit: number | null;
  max_loss: number | null;
  breakevens: number[];
  payoff_curve: { price: number; pnl: number }[];
}

export interface TradeCardData {
  symbol: string;
  currentPrice: number;
  change: number;
  changePct: number;
  positionQty?: number;
  positionPnl?: number;
  positionPnlPct?: number;
  sparklineData?: number[];
}

export interface PortfolioCardData {
  totalValue: number;
  dailyPnl: number;
  dailyPnlPct: number;
  topPositions: Array<{ symbol: string; weight: number; pnl: number; pnlPct: number }>;
  allocation: Array<{ name: string; value: number; color: string }>;
}

export interface OptionsCardData {
  symbol: string;
  expiration: string;
  strike: number;
  type: 'call' | 'put';
  premium: number;
  iv: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  breakeven: number;
}

export interface GuardCardData {
  verdict: 'CLEAR' | 'CAUTION' | 'STOP';
  verdictMessage: string;
  symbol: string;
  side: 'buy' | 'sell';
  behavioralAlerts: Array<{
    type: string;
    severity: string;
    title: string;
    message: string;
    recommendation: string;
  }>;
  kellySizing: {
    proposedShares: number;
    proposedPct: string;
    halfKellyShares: number;
    halfKellyPct: string;
    regimeAdjustedShares: number;
    verdict: string;
    verdictMessage: string;
  };
  regime: {
    label: string;
    advice: string;
    regimeMultiplier: number;
  };
  concentration?: {
    concentrationPct: string;
    warning: string | null;
  };
}

export interface InsiderCardData {
  symbol: string;
  insiderTrades: Array<{
    name: string;
    title: string;
    transactionType: 'buy' | 'sell';
    shares: number;
    totalValue: number;
    date: string;
  }>;
  congressTrades: Array<{
    representative: string;
    party: string;
    transactionType: string;
    amount: string;
    date: string;
  }>;
  signals: Array<{
    type: string;
    description: string;
    confidence: number;
  }>;
  summary: {
    insiderBuys: number;
    insiderSells: number;
    congressBuys: number;
    congressSells: number;
  };
}

export interface GEXCardData {
  symbol: string;
  spotPrice: number;
  netGEX: number;
  regime: 'positive' | 'negative';
  impact: string;
  levels: {
    putWall: number;
    callWall: number;
    hvl: number;
    gammaFlip: number;
    pinStrikes: number[];
  };
  dataSource: string;
}
