// F2 — RSU concentration hedge analyzer (Agent Team).
//
// Wes's largest single position is Anthropic RSUs (~$1.49M, 44.9% of net
// worth, ~70% of liquid wealth excluding the franchise). Anthropic is
// private so the RSU has no direct hedge instrument — but its return is
// strongly correlated with the AI/cloud sector. This module computes the
// concentration, fetches live quotes for proxy hedge instruments, then
// runs a single Claude call that produces three structured sections:
//   1. BULL case (don't hedge, ride the IPO upside)
//   2. BEAR case (hedge aggressively, capture diversification benefit)
//   3. SYNTHESIS (Wes-specific recommendation with sizes)

import { anthropic, CLAUDE_MODEL_PRIMARY } from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { cachedSystem } from '@/lib/prompts';
import { getQuote, type FmpQuote } from '@/lib/fmp-client';
import { createServiceClient } from '@/lib/supabase';

const HEDGE_TEAM_SYSTEM_PROMPT = `You are the Glastonbury Hedge Desk — an Agent Team that decides whether and how to hedge Wes's Anthropic RSU concentration risk.

You play THREE personas in one response:

1. BULL CHALLENGER — argue against hedging. Cover: Anthropic's IPO upside, RSU vesting cliff economics (selling early forfeits unvested), Buffett-style "concentration is how you get rich, diversification is how you stay rich", capital-gains tax drag from premature hedge unwinds, and that Wes's other 55% of NW is already diversified across CR3 + real estate.

2. BEAR CHALLENGER — argue for aggressive hedging. Cover: 44%+ single-stock concentration is the textbook recipe for ruin (cite Enron, WaMu, GE alums), Anthropic is private so the RSU is illiquid AND can mark down 50%+ on a bad funding round, Wes's CR3 income depends on an unrelated franchise system but his W-2 also comes from Anthropic — that's TWO economic eggs in the same basket, hedging via short AI proxies (NVDA / MSFT / GOOG / XLK) captures the public-market beta of the RSU without affecting unvested shares.

3. SYNTHESIS — give Wes a concrete recommendation: SHOULD he hedge, and if so, exactly WHAT instrument(s), what notional size, and what trigger condition would force a re-evaluation. Be specific (e.g. "buy 5 XLK Jan-2027 $200 puts at $12 each = $6K premium for $100K of put protection").

The concentration figures are computed deterministically by the application and are given to you in the prompt — do NOT recompute them, and do not include a "concentration" object in your response. Reason FROM those numbers.

Respond in strict JSON, no prose, no markdown. Shape:
{
  "bullCase": {
    "headline": "<one-sentence position>",
    "points": ["<3-5 bullet arguments>"]
  },
  "bearCase": {
    "headline": "<one-sentence position>",
    "points": ["<3-5 bullet arguments>"]
  },
  "synthesis": {
    "verdict": "no-hedge" | "partial-hedge" | "full-hedge",
    "rationale": "<2-3 sentence summary of why>",
    "actions": [
      {
        "instrument": "<ticker or strategy name>",
        "notionalUSD": <number>,
        "tradeShape": "<concrete description, e.g. 'Buy 5 XLK Jan-2027 $200 puts'>",
        "rationale": "<one sentence>"
      }
    ],
    "reEvalTrigger": "<one-sentence condition that would force re-evaluation>"
  }
}

Numerical fields must be numbers, not strings. Round percentages to one decimal.`;

const HEDGE_PROXIES = ['NVDA', 'MSFT', 'GOOG', 'XLK', 'QQQ'] as const;

export type RiskLevel = 'low' | 'moderate' | 'high' | 'extreme';

export interface ConcentrationSummary {
  rsuValue: number;
  liquidNetWorth: number;
  rsuPctOfLiquid: number;
  rsuPctOfTotal: number;
  riskLevel: RiskLevel;
}

/**
 * Risk bands, expressed as a share of LIQUID net worth (RSU + brokerage
 * + cash). Illiquid assets — the house, the CR3 franchise — cannot be
 * sold to cover a drawdown in a concentrated position, so measuring
 * against total net worth would understate the exposure.
 *
 * These thresholds follow conventional single-position guidance. They
 * are policy, not arithmetic: adjust them here, deliberately, rather
 * than letting a language model invent a different band each run.
 */
const RISK_BANDS: Array<[number, RiskLevel]> = [
  [50, 'extreme'],
  [25, 'high'],
  [10, 'moderate'],
  [0, 'low'],
];

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Compute the concentration figures IN CODE.
 *
 * These numbers drive a real hedging decision on Wes's largest single
 * position, so they must be reproducible and auditable. They used to be
 * filled in by Claude from the system prompt and passed through to the
 * API response untouched.
 */
export function computeConcentration(
  wealth: Awaited<ReturnType<typeof loadWealthSnapshot>>,
): ConcentrationSummary {
  const rsuValue = num(wealth.rsu);
  const liquidNetWorth = rsuValue + num(wealth.brokerage) + num(wealth.cash);
  const total = num(wealth.total);

  const pct = (part: number, whole: number): number =>
    whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

  const rsuPctOfLiquid = pct(rsuValue, liquidNetWorth);
  const rsuPctOfTotal = pct(rsuValue, total);

  const riskLevel = RISK_BANDS.find(([floor]) => rsuPctOfLiquid >= floor)?.[1] ?? 'low';

  return { rsuValue, liquidNetWorth, rsuPctOfLiquid, rsuPctOfTotal, riskLevel };
}

const VERDICTS = new Set(['no-hedge', 'partial-hedge', 'full-hedge']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Validate the narrative half of the model's response.
 *
 * The old code did `{...parsed, proxyQuotes, modelUsed}` with no checks,
 * so a truncated response (max_tokens is 1500) produced an object with
 * no bullCase / synthesis at all and the client read fields off
 * undefined. Returns null when the shape cannot be trusted.
 */
function parseNarrative(parsed: unknown): Omit<HedgeAnalysisResult, 'concentration' | 'proxyQuotes' | 'modelUsed'> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;

  const readCase = (v: unknown): { headline: string; points: string[] } | null => {
    if (!v || typeof v !== 'object') return null;
    const c = v as Record<string, unknown>;
    const headline = str(c.headline);
    const points = strList(c.points);
    return headline && points ? { headline, points } : null;
  };

  const bullCase = readCase(p.bullCase);
  const bearCase = readCase(p.bearCase);
  if (!bullCase || !bearCase) return null;

  if (!p.synthesis || typeof p.synthesis !== 'object') return null;
  const sy = p.synthesis as Record<string, unknown>;
  const verdict = str(sy.verdict);
  const rationale = str(sy.rationale);
  const reEvalTrigger = str(sy.reEvalTrigger);
  if (!verdict || !VERDICTS.has(verdict) || !rationale || !reEvalTrigger) return null;

  // A hedge action with a non-numeric notional would render as "$NaN".
  const actions = (Array.isArray(sy.actions) ? sy.actions : [])
    .map((a) => (a && typeof a === 'object' ? a as Record<string, unknown> : null))
    .filter((a): a is Record<string, unknown> => a !== null)
    .filter((a) => typeof a.notionalUSD === 'number' && Number.isFinite(a.notionalUSD))
    .map((a) => ({
      instrument: str(a.instrument) ?? 'unspecified',
      notionalUSD: a.notionalUSD as number,
      tradeShape: str(a.tradeShape) ?? '',
      rationale: str(a.rationale) ?? '',
    }));

  return {
    bullCase,
    bearCase,
    synthesis: {
      verdict: verdict as HedgeAnalysisResult['synthesis']['verdict'],
      rationale,
      actions,
      reEvalTrigger,
    },
  };
}

export interface HedgeAnalysisResult {
  concentration: {
    rsuValue: number;
    liquidNetWorth: number;
    rsuPctOfLiquid: number;
    rsuPctOfTotal: number;
    riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  };
  bullCase: { headline: string; points: string[] };
  bearCase: { headline: string; points: string[] };
  synthesis: {
    verdict: 'no-hedge' | 'partial-hedge' | 'full-hedge';
    rationale: string;
    actions: Array<{
      instrument: string;
      notionalUSD: number;
      tradeShape: string;
      rationale: string;
    }>;
    reEvalTrigger: string;
  };
  proxyQuotes: Array<{ symbol: string; price: number; changePct: number }>;
  modelUsed: string;
}

interface WealthAsset {
  asset_class: string;
  name: string | null;
  current_value: number;
}

export async function loadWealthSnapshot(): Promise<{
  rsu: number;
  brokerage: number;
  cash: number;
  realEstate: number;
  franchise: number;
  total: number;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('wealth_assets')
    .select('asset_class, name, current_value');
  const rows = (data as WealthAsset[] | null) ?? [];
  const byClass: Record<string, number> = {};
  for (const r of rows) {
    // A non-numeric current_value would make its class — and the total —
    // NaN, which serialises to null on every route that reads wealth.
    const v = Number(r.current_value);
    if (!Number.isFinite(v)) continue;
    byClass[r.asset_class] = (byClass[r.asset_class] ?? 0) + v;
  }
  const total = Object.values(byClass).reduce((s, v) => s + v, 0);
  return {
    rsu: byClass.rsu ?? 0,
    brokerage: byClass.brokerage ?? 0,
    cash: byClass.cash ?? 0,
    realEstate: byClass.real_estate ?? 0,
    franchise: byClass.franchise ?? 0,
    total,
  };
}

async function fetchProxyQuotes(): Promise<Array<{ symbol: string; price: number; changePct: number }>> {
  // One dead quote must not kill the whole hedge analysis.
  const quotes = await Promise.all(
    HEDGE_PROXIES.map((s) => getQuote(s).catch(() => null)),
  );
  const out: Array<{ symbol: string; price: number; changePct: number }> = [];
  for (let i = 0; i < HEDGE_PROXIES.length; i++) {
    const q = quotes[i] as FmpQuote | null;
    if (q?.price != null) {
      out.push({
        symbol: HEDGE_PROXIES[i],
        price: q.price,
        changePct: typeof q.changePercentage === 'number' ? q.changePercentage : 0,
      });
    }
  }
  return out;
}

function buildContextString(
  wealth: Awaited<ReturnType<typeof loadWealthSnapshot>>,
  proxyQuotes: Array<{ symbol: string; price: number; changePct: number }>,
): string {
  const c = computeConcentration(wealth);
  const liquid = c.liquidNetWorth;
  const lines = [
    'WEALTH SNAPSHOT (as of today):',
    `  Anthropic RSUs:   $${wealth.rsu.toLocaleString()}`,
    `  Brokerage:        $${wealth.brokerage.toLocaleString()}`,
    `  Cash:             $${wealth.cash.toLocaleString()}`,
    `  Real Estate:      $${wealth.realEstate.toLocaleString()}  (Miami Shores)`,
    `  CR3 Franchise:    $${wealth.franchise.toLocaleString()}  (23 territories, illiquid operating asset)`,
    `  ---`,
    `  Total NW:         $${wealth.total.toLocaleString()}`,
    `  Liquid NW (RSU+brokerage+cash): $${liquid.toLocaleString()}`,
    '',
    'CONCENTRATION (computed by the application — use these verbatim):',
    `  RSU as % of liquid NW: ${c.rsuPctOfLiquid.toFixed(1)}%`,
    `  RSU as % of total NW:  ${c.rsuPctOfTotal.toFixed(1)}%`,
    `  Risk level:            ${c.riskLevel}`,
    '',
    'CONTEXT:',
    '  - Anthropic is private (no public ticker). RSUs vest quarterly over 4 years.',
    '  - Wes draws his W-2 from Anthropic — second-order economic exposure.',
    '  - CR3 franchise income is independent of tech; real estate is South Florida.',
    '',
    'HEDGE-PROXY QUOTES (live):',
    ...proxyQuotes.map(q => `  ${q.symbol}: $${q.price.toFixed(2)} (${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}% today)`),
  ];
  return lines.join('\n');
}

export async function analyzeRsuHedge(): Promise<HedgeAnalysisResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const [wealth, proxyQuotes] = await Promise.all([
    loadWealthSnapshot(),
    fetchProxyQuotes(),
  ]);

  if (wealth.rsu <= 0 || wealth.total <= 0) {
    return null;
  }

  const userPrompt = buildContextString(wealth, proxyQuotes);

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL_PRIMARY,
    max_tokens: 1500,
    system: cachedSystem(HEDGE_TEAM_SYSTEM_PROMPT),
    messages: [
      {
        role: 'user',
        content: `${userPrompt}\n\nProduce the hedge-team analysis as the strict JSON described in your system prompt.`,
      },
    ],
  });
  tagAnthropicCall(msg.usage, CLAUDE_MODEL_PRIMARY, { caller: 'rsu-analyzer' });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  if (!text) return null;

  const concentration = computeConcentration(wealth);

  const readJson = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      // Tolerate occasional Claude wrapping the JSON in code fences.
      const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(raw);
      if (!fenceMatch) return null;
      try { return JSON.parse(fenceMatch[1]); } catch { return null; }
    }
  };

  const narrative = parseNarrative(readJson(text));
  if (!narrative) return null;

  return {
    ...narrative,
    // Computed in code, and deliberately LAST so it cannot be overwritten
    // by whatever the model decided the arithmetic was.
    concentration,
    proxyQuotes,
    modelUsed: CLAUDE_MODEL_PRIMARY,
  };
}
