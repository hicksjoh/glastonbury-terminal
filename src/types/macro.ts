// Canonical /api/macro response shape (P0-2, hardening/p0-codex-fixes).
//
// Before this fix, the API emitted `regime.name` and `fedPrediction.action`,
// but the macro page read `regime.regime` and `fedPrediction.prediction` —
// causing the regime badge and Fed Watch panels to crash on load. Both sides
// now agree on this contract.

export interface MacroFactorDetail {
  score: number;
  signal: string;
}

export interface MacroRegime {
  /** Regime key (e.g. "expansion", "late_cycle"). */
  regime: string;
  /** 0..1 confidence in the regime label. */
  confidence: number;
  /** Composite score from the regime engine (e.g. -1..1). */
  score: number;
  /** Per-factor breakdown — used to color macro indicator tiles by signal. */
  factorBreakdown: Record<string, MacroFactorDetail>;
}

export interface FedPrediction {
  /** Taylor-rule-style direction the Fed is implied to take next. */
  prediction: 'hike' | 'hold' | 'cut';
  /** 0..1 confidence in the prediction. */
  confidence: number;
  /** Model-implied rate, e.g. 5.25 for 5.25%. */
  impliedRate: number;
}

export interface MacroIndicatorsView {
  yield10Y: number;
  yield2Y: number;
  yieldCurveSlope: number;
  fedFunds: number;
  vix: number;
  dxy: number;
  creditSpread: number;
  unemploymentRate: number;
  cpi: number;
  gdpGrowth: number;
}

export interface MacroAllocation {
  equities: number;
  bonds: number;
  commodities: number;
  cash: number;
  alternatives: number;
}

export interface MacroEvent {
  date: string;
  event: string;
  importance: string;
}

export interface MacroResponse {
  regime: MacroRegime;
  indicators: MacroIndicatorsView;
  fedPrediction: FedPrediction;
  allocation: MacroAllocation;
  upcomingEvents: MacroEvent[];
  interpretation: string;
  lastUpdated: string;
}
