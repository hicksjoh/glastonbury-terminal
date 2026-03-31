export interface Portfolio {
  totalNetWorth: number;
  alpacaEquity: number;
  alpacaCash: number;
  cr3Equity: number;
  anthropicRSUs: number;
  miamiShoresProperty: number;
  otherCash: number;
  lastUpdated: string;
}

export interface Position {
  symbol: string;
  qty: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  currentPrice: number;
  side: 'long' | 'short';
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  filledAvgPrice?: number;
  submittedAt: string;
  filledAt?: string;
}

export interface Strategy {
  id: string;
  name: string;
  type: 'covered_call_wheel' | 'tax_loss_harvest' | 'auto_rebalance' | 'rsu_diversification';
  status: 'active' | 'paused' | 'paper';
  params: Record<string, unknown>;
  performance: {
    totalReturn: number;
    totalReturnPct: number;
    tradesExecuted: number;
    lastRun?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  details: string;
  status: 'success' | 'failed' | 'pending';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  companyName: string;
  currentPrice: number;
  fairValue: number;
  moat: 'wide' | 'narrow' | 'none';
  stars: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

export interface RoadmapEntry {
  year: number;
  engine: string;
  projected: number;
  actual?: number;
}

export interface PortfolioSnapshot {
  id: string;
  date: string;
  totalEquity: number;
  cash: number;
  pnl: number;
  cr3Value: number;
  rsuValue: number;
  propertyValue: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AlpacaAccount {
  id: string;
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  status: string;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  side: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  side: string;
  qty: string;
  type: string;
  limit_price?: string;
  status: string;
  filled_avg_price?: string;
  submitted_at: string;
  filled_at?: string;
}

export interface MonteCarloResult {
  simulations: number[][];
  percentiles: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  years: number[];
  targetProbability: number;
  medianOutcome: number;
}
