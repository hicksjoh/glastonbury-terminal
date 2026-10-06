import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import { tagAnthropicCall } from './anthropic-cost';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Keisha auto-uses the newest Claude family. `LATEST_BY_TIER` is the
// single place to bump when a new family drops — everything downstream
// resolves through it.
//
// Two paths to "always latest":
//
//   1. Do nothing — if CLAUDE_MODEL_PRIMARY / FALLBACK / FAST are unset,
//      empty, or set to "auto" / "latest", Keisha uses LATEST_BY_TIER.
//
//   2. Force override — set CLAUDE_AUTO_LATEST=true and ANY pinned
//      value in the tier vars is ignored. Use this when you've got
//      old pins in .env you can't easily unset (Vercel, .env.local,
//      or CI). One line, no editing of the existing tier vars.
//
// To pin a specific model for evals / A/B / cost tests, set:
//   CLAUDE_AUTO_LATEST=false
//   CLAUDE_MODEL_PRIMARY=claude-opus-5-5
//
// As of 2026-10 the most capable generally available model is Claude
// Fable 5.1 (the tier above Opus). Sonnet 5.5 is the current Sonnet.
// No Haiku 5 has shipped yet, so the fast tier stays on Haiku 4.5.
//
// Fable 5.1 / Sonnet 5.5 always think (it can't be disabled) and
// max_tokens caps thinking + visible text together — size max_tokens
// with modelBudget() and read replies with textOf(), never content[0].
export const LATEST_BY_TIER = {
  primary:  'claude-fable-5-1',
  fallback: 'claude-sonnet-5-5',
  fast:     'claude-haiku-4-5',
} as const;

function isTruthy(v: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
}

// AUTO_LATEST override: when true, ignore pinned tier env vars and
// always resolve to LATEST_BY_TIER. Defaults to false — existing
// deployments that pin models keep their pins until they opt in.
const AUTO_LATEST = isTruthy(process.env.CLAUDE_AUTO_LATEST);

function resolveModel(envValue: string | undefined, tier: keyof typeof LATEST_BY_TIER): string {
  if (AUTO_LATEST) return LATEST_BY_TIER[tier];
  const v = (envValue ?? '').trim().toLowerCase();
  if (!v || v === 'auto' || v === 'latest') return LATEST_BY_TIER[tier];
  return envValue!.trim();
}

export const CLAUDE_MODEL_PRIMARY  = resolveModel(process.env.CLAUDE_MODEL_PRIMARY,  'primary');
export const CLAUDE_MODEL_FALLBACK = resolveModel(process.env.CLAUDE_MODEL_FALLBACK, 'fallback');
export const CLAUDE_MODEL_FAST     = resolveModel(process.env.CLAUDE_MODEL_FAST,     'fast');

// Dead-man check for the "always latest" promise: a stale pin in the
// environment silently beats LATEST_BY_TIER (prod sat on a 172-day-old
// Opus 4.7 pin while this file said "auto-uses the newest"). Surface any
// tier that is resolving to something other than the latest so /api/health
// and the boot log can say so out loud.
export function getModelDrift(): Array<{ tier: keyof typeof LATEST_BY_TIER; resolved: string; latest: string }> {
  const resolved = { primary: CLAUDE_MODEL_PRIMARY, fallback: CLAUDE_MODEL_FALLBACK, fast: CLAUDE_MODEL_FAST };
  return (Object.keys(LATEST_BY_TIER) as Array<keyof typeof LATEST_BY_TIER>)
    .filter(tier => resolved[tier] !== LATEST_BY_TIER[tier])
    .map(tier => ({ tier, resolved: resolved[tier], latest: LATEST_BY_TIER[tier] }));
}

for (const d of getModelDrift()) {
  console.warn(`[claude] ${d.tier} tier is pinned to ${d.resolved}; latest is ${d.latest}. Unset CLAUDE_MODEL_${d.tier.toUpperCase()} or set CLAUDE_AUTO_LATEST=true to follow latest.`);
}

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Thinking tokens come out of max_tokens on every model that thinks by
// default. A visible-length cap sized for a non-thinking model (voice: 600)
// gets eaten by reasoning and the reply comes back truncated or empty.
const THINKING_HEADROOM_TOKENS = 8_000;

function thinksByDefault(model: string): boolean {
  // Haiku 4.5 and the Opus 4.x / Sonnet 4.x pins run without thinking
  // unless asked; everything newer thinks on its own.
  return !/^claude-(haiku|opus-4|sonnet-4)/.test(model);
}

/**
 * Request sizing for a model: `visibleTokens` is the room the reply itself
 * needs; thinking headroom is added on models that always think. `effort`
 * is only sent to models that think by default (Haiku 4.5 rejects it).
 * Spread the result into messages.create / messages.stream.
 */
export function modelBudget(
  model: string,
  visibleTokens: number,
  effort?: ClaudeEffort,
): { max_tokens: number; output_config?: { effort: ClaudeEffort } } {
  if (!thinksByDefault(model)) return { max_tokens: visibleTokens };
  return {
    max_tokens: visibleTokens + THINKING_HEADROOM_TOKENS,
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/**
 * The reply text of a message. Thinking models lead `content` with
 * thinking blocks, so `content[0]` is not the answer; a refusal
 * (stop_reason "refusal") has no usable text at all.
 */
export function textOf(message: { content: Array<{ type: string; text?: string }>; stop_reason?: string | null }): string {
  if (message.stop_reason === 'refusal') return '';
  return message.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('');
}

function isRetryableStatus(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 529 || status === 503;
}

export async function createMessageWithFallback(
  params: Omit<MessageCreateParamsNonStreaming, 'model'>,
): Promise<{ message: Awaited<ReturnType<typeof anthropic.messages.create>>; modelUsed: string }> {
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRIMARY,
      ...params,
    });
    tagAnthropicCall(message.usage, CLAUDE_MODEL_PRIMARY, { caller: 'createMessageWithFallback' });
    return { message, modelUsed: CLAUDE_MODEL_PRIMARY };
  } catch (err) {
    if (!isRetryableStatus(err)) throw err;
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL_FALLBACK,
      ...params,
    });
    tagAnthropicCall(message.usage, CLAUDE_MODEL_FALLBACK, { caller: 'createMessageWithFallback', fallback: true });
    return { message, modelUsed: CLAUDE_MODEL_FALLBACK };
  }
}

export async function streamMessageWithFallback(
  params: Omit<Parameters<typeof anthropic.messages.stream>[0], 'model'>,
): Promise<{ stream: ReturnType<typeof anthropic.messages.stream>; modelUsed: string }> {
  try {
    const stream = anthropic.messages.stream({ model: CLAUDE_MODEL_PRIMARY, ...params });
    return { stream, modelUsed: CLAUDE_MODEL_PRIMARY };
  } catch (err) {
    if (!isRetryableStatus(err)) throw err;
    const stream = anthropic.messages.stream({ model: CLAUDE_MODEL_FALLBACK, ...params });
    return { stream, modelUsed: CLAUDE_MODEL_FALLBACK };
  }
}

// KEISHA_SYSTEM_PROMPT lives in src/lib/prompts/keisha-system.ts so we can
// wrap it with cache_control: ephemeral (Anthropic prompt caching). That
// prompt is ~4K tokens and we pay full-price input tokens on every Claude
// call if uncached; caching drops cached reads to ~10% of a write and
// persists ~5 min. See generateBriefing + generateAnalysis below.
import { APP_TIME_ZONE } from './et-clock';
import { KEISHA_SYSTEM_PROMPT, cachedSystem } from './prompts';
export { KEISHA_SYSTEM_PROMPT };

export async function generateBriefing(portfolioContext: string): Promise<string> {
  // US market date, not the server's UTC date: after 8pm ET a bare
  // toLocaleDateString() on Vercel is already "tomorrow".
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: APP_TIME_ZONE,
  });

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL_PRIMARY,
    ...modelBudget(CLAUDE_MODEL_PRIMARY, 1200),
    system: cachedSystem(KEISHA_SYSTEM_PROMPT),
    messages: [{
      role: 'user',
      content: `Generate a concise morning financial briefing for today, ${today}.

LIVE PORTFOLIO DATA:
${portfolioContext}

Include:
1. Market outlook & what to watch today
2. Top 1-2 actions to consider RIGHT NOW
3. Progress check toward $50M goal (use actual numbers)
4. One strategic insight or opportunity Wes should be thinking about

Keep it under 250 words. Sharp, actionable, and personalized to Wes's actual portfolio. No filler.`
    }]
  });

  tagAnthropicCall(message.usage, CLAUDE_MODEL_PRIMARY, { caller: 'generateBriefing' });
  return textOf(message);
}

export async function generateAnalysis(
  query: string,
  portfolioContext: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  // US market date, not the server's UTC date: after 8pm ET a bare
  // toLocaleDateString() on Vercel is already "tomorrow".
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: APP_TIME_ZONE,
  });

  const dynamicContext = `═══════════════════════════════════════════
  LIVE DATA (as of ${today})
═══════════════════════════════════════════
${portfolioContext}

When answering, always ground your response in the live data above. If certain data points are missing (e.g., market is closed, no positions yet), acknowledge it and work with what you have. Never fabricate numbers.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL_PRIMARY,
    ...modelBudget(CLAUDE_MODEL_PRIMARY, 4096),
    system: cachedSystem(KEISHA_SYSTEM_PROMPT, dynamicContext),
    messages: conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  });

  tagAnthropicCall(response.usage, CLAUDE_MODEL_PRIMARY, { caller: 'generateAnalysis' });
  return textOf(response);
}
