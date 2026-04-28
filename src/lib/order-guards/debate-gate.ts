// F11 — Debate-agent trade approval gate.
//
// For any order whose notional value exceeds DEBATE_THRESHOLD_USD we run
// a *quick* bull-vs-bear debate via a single Haiku call (vs the existing
// full-fidelity 3-round SSE debate at /api/debate/run, which costs more
// latency than we want in the order path).
//
// The gate returns approve / caution / reject. The orders route hard-
// blocks "reject" unless `force: true` is set, surfaces "caution" as a
// warning the UI can show, and lets "approve" pass through silently.

import { anthropic, CLAUDE_MODEL_FAST } from '@/lib/claude';
import { cachedSystem } from '@/lib/prompts';

const DEBATE_THRESHOLD_USD = 5_000;

const DEBATE_GATE_SYSTEM = `You are the Glastonbury order-flow debate gate. A trader is about to submit an order; before it goes live you stand up a 30-second bull-vs-bear in your head and emit a verdict.

You play three roles inline:
1. BULL CHALLENGER — strongest concise argument FOR the trade, grounded in the data the trader provides.
2. BEAR CHALLENGER — strongest concise argument AGAINST the trade.
3. JUDGE — pick a verdict and a one-sentence rationale.

Verdict scale:
  approve  - both sides argue cleanly, the trade is sound, no major obstacle.
  caution  - bear case has real teeth; trade can still proceed but trader should know what could go wrong.
  reject   - bear case is decisive (e.g., obvious wash-sale, gap-risk, illiquid name, position-size violation, recent panic-sell pattern). The trader must explicitly override.

Output strict JSON only, no prose, no markdown fences:
{
  "verdict":  "approve" | "caution" | "reject",
  "rationale": "<one sentence>",
  "bullPoint": "<one sentence>",
  "bearPoint": "<one sentence>",
  "modelUsed": "haiku-4.5"
}

Be calibrated. Most defensible, sanely-sized orders are "approve" — reserve "reject" for things that are genuinely bad ideas, not just contrarian.`;

export interface DebateGateInput {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  estimatedPrice: number;
  /** Optional context — current portfolio exposure, recent journal entries, etc. */
  contextNotes?: string;
}

export interface DebateGateVerdict {
  verdict: 'approve' | 'caution' | 'reject';
  rationale: string;
  bullPoint: string;
  bearPoint: string;
  notional: number;
  triggered: boolean;
  modelUsed: string;
}

export function shouldRunDebateGate(notionalUSD: number): boolean {
  return notionalUSD >= DEBATE_THRESHOLD_USD;
}

export async function runDebateGate(input: DebateGateInput): Promise<DebateGateVerdict> {
  const notional = input.qty * input.estimatedPrice;
  if (!shouldRunDebateGate(notional)) {
    return {
      verdict: 'approve',
      rationale: `Order notional ($${Math.round(notional).toLocaleString()}) below the $${DEBATE_THRESHOLD_USD.toLocaleString()} debate threshold; approved without challenge.`,
      bullPoint: '',
      bearPoint: '',
      notional,
      triggered: false,
      modelUsed: 'skipped',
    };
  }

  // Anthropic SDK isn't configured in some environments — degrade to
  // "caution" so the order isn't silently approved without scrutiny.
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      verdict: 'caution',
      rationale: 'Debate gate could not run because ANTHROPIC_API_KEY is unset; gate is failing closed to caution rather than silently approving.',
      bullPoint: '',
      bearPoint: '',
      notional,
      triggered: true,
      modelUsed: 'unavailable',
    };
  }

  const userPrompt = [
    'PROPOSED TRADE:',
    `  ${input.side.toUpperCase()} ${input.qty} ${input.symbol} @ ~$${input.estimatedPrice.toFixed(2)}`,
    `  Notional: $${Math.round(notional).toLocaleString()}`,
    '',
    input.contextNotes ? `CONTEXT:\n${input.contextNotes}` : 'CONTEXT: (none provided)',
    '',
    'Run the debate. Return strict JSON.',
  ].join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_FAST,
      max_tokens: 400,
      system: cachedSystem(DEBATE_GATE_SYSTEM),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    const v = parsed.verdict as 'approve' | 'caution' | 'reject';
    if (!['approve', 'caution', 'reject'].includes(v)) {
      throw new Error(`Unexpected verdict: ${v}`);
    }
    return {
      verdict: v,
      rationale: String(parsed.rationale ?? ''),
      bullPoint: String(parsed.bullPoint ?? ''),
      bearPoint: String(parsed.bearPoint ?? ''),
      notional,
      triggered: true,
      modelUsed: CLAUDE_MODEL_FAST,
    };
  } catch (err) {
    // Fail closed: any error in the debate gate becomes caution, not approve.
    return {
      verdict: 'caution',
      rationale: `Debate gate errored (${err instanceof Error ? err.message : 'unknown'}); fell back to caution.`,
      bullPoint: '',
      bearPoint: '',
      notional,
      triggered: true,
      modelUsed: 'error',
    };
  }
}
