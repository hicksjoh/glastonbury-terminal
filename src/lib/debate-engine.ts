/**
 * Phase 12 — Bull vs Bear Debate Mode.
 *
 * Orchestrates 3 rounds of back-and-forth between Bull and Bear agents,
 * then a Moderator issues a verdict + confidence + key tension points.
 * Persists to trade_debates.
 */

import { anthropic, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';
import { fetchQuote, fetchCompanyProfile, fetchRecentNews, fetchBars, computeIndicators } from '@/lib/crew-data';

const ROUNDS = 3;

const BULL_SYSTEM = `You are the BULL analyst on Wes's trading desk. You argue the LONG / BULLISH side with rigor.

Rules:
- MAX 90 words per round. Number-dense. Cite concrete figures from the data.
- Round 1: opening case. Round 2: counter the Bear directly. Round 3: closing pivot.
- Never hedge. You ARE the Bull.`;

const BEAR_SYSTEM = `You are the BEAR analyst on Wes's trading desk. You argue the SHORT / BEARISH side with rigor.

Rules:
- MAX 90 words per round. Number-dense. Cite concrete figures from the data.
- Round 1: opening case. Round 2: counter the Bull directly. Round 3: closing pivot.
- Never hedge. You ARE the Bear.`;

const MODERATOR_SYSTEM = `You are the moderating portfolio manager. Three rounds of Bull/Bear debate are complete. Render a verdict.

Return ONLY a JSON object (no markdown fences) matching this exact shape:
{
  "verdict": "BULL" | "BEAR" | "NEUTRAL" | "PASS",
  "confidence": number,           // 0-100
  "rationale": string,            // 3-6 sentences explaining which side had the stronger case AND why.
  "key_tension_points": [         // 3-5 items where the two sides genuinely disagreed
    { "point": string, "bull_claim": string, "bear_claim": string, "my_view": string }
  ]
}`;

export type DebateEvent =
  | { type: 'meta'; ticker: string; data_health: { quote: boolean; profile: boolean; bars: number; news: number } }
  | { type: 'round'; n: number; side: 'bull' | 'bear'; event: 'start' | 'token' | 'done'; delta?: string; text?: string }
  | { type: 'moderator'; event: 'start' | 'token' | 'done' | 'parsed'; delta?: string; verdict?: string; confidence?: number; rationale?: string; tension_points?: unknown }
  | { type: 'complete'; totalCostUsd: number; totalLatencyMs: number; model: string }
  | { type: 'error'; message: string };

export type ProposedTrade = {
  side: 'buy' | 'sell';
  structure?: string;
  qty?: number;
  entry?: string;
  target?: string;
  stop?: string;
};

async function gatherDebateData(ticker: string) {
  const [quote, profile, bars, news] = await Promise.all([
    fetchQuote(ticker),
    fetchCompanyProfile(ticker),
    fetchBars(ticker, '1Day', 120),
    fetchRecentNews(ticker, 72, 10),
  ]);
  return {
    ticker,
    quote,
    profile,
    indicators: bars.length > 10 ? computeIndicators(bars) : null,
    news,
    bars_count: bars.length,
  };
}

function stringifyDataForPrompt(ticker: string, data: Awaited<ReturnType<typeof gatherDebateData>>, trade: ProposedTrade | null) {
  return `Ticker: ${ticker}

DATA PACKAGE:
${JSON.stringify({
  quote: data.quote, profile: data.profile, indicators: data.indicators,
  news_headlines: data.news.map(n => ({ title: n.headline, source: n.source, date: n.datetime })),
}, null, 2)}

${trade ? `PROPOSED TRADE: ${JSON.stringify(trade, null, 2)}` : ''}`;
}

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};
function cost(model: string, tIn: number, tOut: number): number {
  const p = PRICE_PER_M[model] ?? { input: 3, output: 15 };
  return (tIn / 1_000_000) * p.input + (tOut / 1_000_000) * p.output;
}

type RoundOutput = { side: 'bull' | 'bear'; round: number; text: string; tokens_in: number; tokens_out: number; model: string };

async function runSideRound(args: {
  side: 'bull' | 'bear';
  round: number;
  ticker: string;
  dataBlob: string;
  priorRounds: RoundOutput[];
  onToken: (delta: string) => void;
}): Promise<RoundOutput> {
  const system = args.side === 'bull' ? BULL_SYSTEM : BEAR_SYSTEM;
  const otherSide = args.side === 'bull' ? 'Bear' : 'Bull';

  const historyText = args.priorRounds
    .map(r => `Round ${r.round} — ${r.side.toUpperCase()}:\n${r.text}`)
    .join('\n\n');

  const userPrompt = `${args.dataBlob}

${historyText ? `\nDEBATE SO FAR:\n${historyText}\n\n` : ''}It is now Round ${args.round} for the ${args.side.toUpperCase()}${args.round > 1 ? `. Respond directly to the ${otherSide}'s previous round and add new evidence.` : '. Make your opening case.'}`;

  const callStream = (model: string) => anthropic.messages.stream({
    model, max_tokens: 500, system, messages: [{ role: 'user', content: userPrompt }],
  });

  let model = CLAUDE_MODEL_FALLBACK; // Sonnet for debaters — speed + cost
  let stream: ReturnType<typeof anthropic.messages.stream>;
  try {
    stream = callStream(model);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529 || status === 503) {
      model = CLAUDE_MODEL_PRIMARY;
      stream = callStream(model);
    } else throw err;
  }

  let text = '';
  stream.on('text', (delta: string) => { text += delta; args.onToken(delta); });
  const finalMsg = await stream.finalMessage();
  return {
    side: args.side,
    round: args.round,
    text,
    tokens_in: finalMsg.usage?.input_tokens ?? 0,
    tokens_out: finalMsg.usage?.output_tokens ?? 0,
    model,
  };
}

async function runModerator(args: {
  ticker: string;
  dataBlob: string;
  rounds: RoundOutput[];
  onToken: (delta: string) => void;
}): Promise<{ raw: string; tokens_in: number; tokens_out: number; model: string }> {
  const transcript = args.rounds.map(r => `Round ${r.round} — ${r.side.toUpperCase()}:\n${r.text}`).join('\n\n');
  const userPrompt = `${args.dataBlob}\n\nFULL DEBATE TRANSCRIPT:\n${transcript}\n\nRender the verdict now as JSON.`;

  const callStream = (model: string) => anthropic.messages.stream({
    model, max_tokens: 1500, system: MODERATOR_SYSTEM, messages: [{ role: 'user', content: userPrompt }],
  });

  let model = CLAUDE_MODEL_PRIMARY; // Opus for moderator
  let stream: ReturnType<typeof anthropic.messages.stream>;
  try {
    stream = callStream(model);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 529 || status === 503) {
      model = CLAUDE_MODEL_FALLBACK;
      stream = callStream(model);
    } else throw err;
  }

  let text = '';
  stream.on('text', (delta: string) => { text += delta; args.onToken(delta); });
  const finalMsg = await stream.finalMessage();
  return {
    raw: text,
    tokens_in: finalMsg.usage?.input_tokens ?? 0,
    tokens_out: finalMsg.usage?.output_tokens ?? 0,
    model,
  };
}

type ParsedModerator = {
  verdict?: string;
  confidence?: number;
  rationale?: string;
  key_tension_points?: Array<{ point?: string; bull_claim?: string; bear_claim?: string; my_view?: string }>;
};

export function parseModerator(raw: string): ParsedModerator & { verdict: 'BULL'|'BEAR'|'NEUTRAL'|'PASS'; confidence: number; rationale: string; key_tension_points: Array<{ point: string; bull_claim: string; bear_claim: string; my_view: string }> } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = m ? m[0] : cleaned;
  let j: ParsedModerator = {};
  try { j = JSON.parse(jsonStr) as ParsedModerator; } catch { /* noop */ }
  const verdict = ['BULL','BEAR','NEUTRAL','PASS'].includes(String(j.verdict)) ? j.verdict as 'BULL'|'BEAR'|'NEUTRAL'|'PASS' : 'NEUTRAL';
  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)),
    rationale: String(j.rationale ?? '').slice(0, 4000),
    key_tension_points: Array.isArray(j.key_tension_points)
      ? j.key_tension_points.slice(0, 6).map(t => ({
          point: String(t?.point ?? ''),
          bull_claim: String(t?.bull_claim ?? ''),
          bear_claim: String(t?.bear_claim ?? ''),
          my_view: String(t?.my_view ?? ''),
        }))
      : [],
  };
}

export type DebateResult = {
  bullRounds: RoundOutput[];
  bearRounds: RoundOutput[];
  moderator: {
    raw: string;
    verdict: 'BULL' | 'BEAR' | 'NEUTRAL' | 'PASS';
    confidence: number;
    rationale: string;
    key_tension_points: Array<{ point: string; bull_claim: string; bear_claim: string; my_view: string }>;
    model: string;
    tokens_in: number;
    tokens_out: number;
  };
  totalCostUsd: number;
  totalLatencyMs: number;
};

export async function runDebate(args: {
  ticker: string;
  proposedTrade: ProposedTrade | null;
  onEvent: (e: DebateEvent) => void;
}): Promise<DebateResult> {
  const t0 = Date.now();
  const data = await gatherDebateData(args.ticker);
  args.onEvent({
    type: 'meta', ticker: args.ticker,
    data_health: { quote: !!data.quote, profile: !!data.profile, bars: data.bars_count, news: data.news.length },
  });
  const dataBlob = stringifyDataForPrompt(args.ticker, data, args.proposedTrade);

  const bullRounds: RoundOutput[] = [];
  const bearRounds: RoundOutput[] = [];

  for (let r = 1; r <= ROUNDS; r++) {
    // Bull goes first each round
    args.onEvent({ type: 'round', n: r, side: 'bull', event: 'start' });
    const bull = await runSideRound({
      side: 'bull', round: r, ticker: args.ticker, dataBlob,
      priorRounds: [...bullRounds, ...bearRounds].sort((a, b) => (a.round - b.round) * 10 + (a.side === 'bull' ? 0 : 1)),
      onToken: d => args.onEvent({ type: 'round', n: r, side: 'bull', event: 'token', delta: d }),
    });
    bullRounds.push(bull);
    args.onEvent({ type: 'round', n: r, side: 'bull', event: 'done', text: bull.text });

    args.onEvent({ type: 'round', n: r, side: 'bear', event: 'start' });
    const bear = await runSideRound({
      side: 'bear', round: r, ticker: args.ticker, dataBlob,
      priorRounds: [...bullRounds, ...bearRounds].sort((a, b) => (a.round - b.round) * 10 + (a.side === 'bull' ? 0 : 1)),
      onToken: d => args.onEvent({ type: 'round', n: r, side: 'bear', event: 'token', delta: d }),
    });
    bearRounds.push(bear);
    args.onEvent({ type: 'round', n: r, side: 'bear', event: 'done', text: bear.text });
  }

  // Moderator
  args.onEvent({ type: 'moderator', event: 'start' });
  const interleaved = [];
  for (let i = 0; i < ROUNDS; i++) { interleaved.push(bullRounds[i]); interleaved.push(bearRounds[i]); }
  const mod = await runModerator({
    ticker: args.ticker, dataBlob, rounds: interleaved,
    onToken: d => args.onEvent({ type: 'moderator', event: 'token', delta: d }),
  });
  const parsed = parseModerator(mod.raw);
  args.onEvent({
    type: 'moderator', event: 'done',
    verdict: parsed.verdict, confidence: parsed.confidence, rationale: parsed.rationale,
    tension_points: parsed.key_tension_points,
  });

  const allRounds = [...bullRounds, ...bearRounds];
  const totalCost = allRounds.reduce((s, r) => s + cost(r.model, r.tokens_in, r.tokens_out), 0)
    + cost(mod.model, mod.tokens_in, mod.tokens_out);

  return {
    bullRounds, bearRounds,
    moderator: {
      raw: mod.raw,
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      key_tension_points: parsed.key_tension_points,
      model: mod.model,
      tokens_in: mod.tokens_in,
      tokens_out: mod.tokens_out,
    },
    totalCostUsd: totalCost,
    totalLatencyMs: Date.now() - t0,
  };
}
