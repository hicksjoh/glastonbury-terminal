// ─── Keisha AI Type Definitions ─────────────────────────────────────────────

export type ExplanationLevel = 'technical' | 'balanced' | 'plain_talk';

export interface KeishaSettings {
  riskTolerance?: number;
  commStyle?: string;
  paperMode?: boolean;
  explanationLevel?: ExplanationLevel;
}

export type CardType = 'trade' | 'portfolio' | 'options' | 'guard' | 'gex' | 'alert' | 'signal';

export interface RenderCard {
  type: CardType;
  data: TradeCardData | PortfolioCardData | OptionsCardData | GuardCardData | GEXCardData;
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
