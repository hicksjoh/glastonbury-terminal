/**
 * Adapter from the /api/monte-carlo-risk response to what the Risk page's
 * Monte Carlo tab renders.
 *
 * The page and the route had drifted to two unrelated shapes: the page read
 * dollar VaR as a percentage, `probLoss` where the route sends
 * `probabilityOfLoss` (so it always showed 0.0%), called `.map` on the
 * `percentiles` object (a crash), read histogram `min/max` where the route
 * sends `rangeStart/rangeEnd`, and fell back to four hardcoded stress losses
 * (-38.5 / -33.9 / -25.4 / -8.7%) because `stressTests` is an array, not the
 * keyed object it expected (QA 2026-10-05, blocker 7).
 *
 * Route units: VaR/CVaR are positive dollar losses, percentiles and histogram
 * bounds are dollar P&L, probabilityOfLoss and stress portfolioImpact are
 * fractions. View units: every return is a signed percent of portfolio value.
 */

export interface MonteCarloApiResponse {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  expectedReturn: number;
  probabilityOfLoss: number;
  percentiles: Record<'p1' | 'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95' | 'p99', number>;
  histogram: { rangeStart: number; rangeEnd: number; count: number }[];
  stressTests: { name: string; description: string; portfolioImpact: number; dollarLoss: number }[];
  portfolioValue: number;
}

export interface MonteCarloView {
  /** Signed return percent at the VaR threshold (a loss is negative). */
  var95: number;
  var99: number;
  cvar95: number;
  /** Dollar loss at each threshold, positive. */
  var95Dollar: number;
  var99Dollar: number;
  cvar95Dollar: number;
  /** 0-100. */
  probLoss: number;
  histogram: { min: number; max: number; midpoint: number; count: number }[];
  stressTests: { name: string; description: string; impact: number; dollarLoss: number }[];
  percentiles: { pct: string; returnPct: number; dollarPL: number }[];
  portfolioValue: number;
}

const PERCENTILE_LABELS: [keyof MonteCarloApiResponse['percentiles'], string][] = [
  ['p1', '1st'], ['p5', '5th'], ['p10', '10th'], ['p25', '25th'], ['p50', '50th (Median)'],
  ['p75', '75th'], ['p90', '90th'], ['p95', '95th'], ['p99', '99th'],
];

/** Returns null when the response cannot be rendered honestly. */
export function toMonteCarloView(api: MonteCarloApiResponse | null | undefined): MonteCarloView | null {
  if (!api || !Number.isFinite(api.portfolioValue) || api.portfolioValue <= 0) return null;
  const pv = api.portfolioValue;
  const pct = (dollars: number) => (dollars / pv) * 100;

  return {
    var95: -pct(api.var95),
    var99: -pct(api.var99),
    cvar95: -pct(api.cvar95),
    var95Dollar: api.var95,
    var99Dollar: api.var99,
    cvar95Dollar: api.cvar95,
    probLoss: api.probabilityOfLoss * 100,
    histogram: (api.histogram ?? []).map((b) => ({
      min: pct(b.rangeStart),
      max: pct(b.rangeEnd),
      midpoint: pct((b.rangeStart + b.rangeEnd) / 2),
      count: b.count,
    })),
    stressTests: (api.stressTests ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      impact: s.portfolioImpact * 100,
      dollarLoss: s.dollarLoss,
    })),
    percentiles: PERCENTILE_LABELS.map(([key, label]) => ({
      pct: label,
      returnPct: pct(api.percentiles[key]),
      dollarPL: api.percentiles[key],
    })),
    portfolioValue: pv,
  };
}
