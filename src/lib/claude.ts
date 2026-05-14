import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming, MessageStreamParams } from '@anthropic-ai/sdk/resources/messages';
import { tagAnthropicCall } from './anthropic-cost';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const CLAUDE_MODEL_PRIMARY = process.env.CLAUDE_MODEL_PRIMARY || 'claude-opus-4-7';
export const CLAUDE_MODEL_FALLBACK = process.env.CLAUDE_MODEL_FALLBACK || 'claude-sonnet-4-6';
export const CLAUDE_MODEL_FAST = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5-20251001';

// Gemini round-3 P0: every anthropic.messages.create()/.stream() must pass an
// AbortSignal so a slow/hung Anthropic call doesn't eat the full Vercel 60s
// function budget AND bill for the full generation. Two module-level constants
// so the SLA can be tuned without chasing every call site.
//   • NON_STREAM_TIMEOUT_MS — synchronous create()s (briefings, summaries).
//   • STREAM_TIMEOUT_MS — fallback when the caller doesn't supply its own
//     signal (a stream's natural lifecycle should already cap it, but a
//     forgotten consumer should still trip the timer).
export const NON_STREAM_TIMEOUT_MS = 30_000;
export const STREAM_TIMEOUT_MS = 120_000;

function isRetryableStatus(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 529 || status === 503;
}

export async function createMessageWithFallback(
  params: Omit<MessageCreateParamsNonStreaming, 'model'>,
  options?: { signal?: AbortSignal },
): Promise<{ message: Awaited<ReturnType<typeof anthropic.messages.create>>; modelUsed: string }> {
  const signal = options?.signal ?? AbortSignal.timeout(NON_STREAM_TIMEOUT_MS);
  try {
    const message = await anthropic.messages.create(
      {
        model: CLAUDE_MODEL_PRIMARY,
        ...params,
      },
      { signal },
    );
    tagAnthropicCall(message.usage, CLAUDE_MODEL_PRIMARY, { caller: 'createMessageWithFallback' });
    return { message, modelUsed: CLAUDE_MODEL_PRIMARY };
  } catch (err) {
    if (!isRetryableStatus(err)) throw err;
    // The original signal may have aborted; use a fresh one for the fallback.
    const fallbackSignal = options?.signal ?? AbortSignal.timeout(NON_STREAM_TIMEOUT_MS);
    const message = await anthropic.messages.create(
      {
        model: CLAUDE_MODEL_FALLBACK,
        ...params,
      },
      { signal: fallbackSignal },
    );
    tagAnthropicCall(message.usage, CLAUDE_MODEL_FALLBACK, { caller: 'createMessageWithFallback', fallback: true });
    return { message, modelUsed: CLAUDE_MODEL_FALLBACK };
  }
}

export async function streamMessageWithFallback(
  params: Omit<MessageStreamParams, 'model'>,
  options?: { signal?: AbortSignal },
): Promise<{ stream: ReturnType<typeof anthropic.messages.stream>; modelUsed: string }> {
  const signal = options?.signal ?? AbortSignal.timeout(STREAM_TIMEOUT_MS);
  try {
    const stream = anthropic.messages.stream(
      { model: CLAUDE_MODEL_PRIMARY, ...params },
      { signal },
    );
    return { stream, modelUsed: CLAUDE_MODEL_PRIMARY };
  } catch (err) {
    if (!isRetryableStatus(err)) throw err;
    const fallbackSignal = options?.signal ?? AbortSignal.timeout(STREAM_TIMEOUT_MS);
    const stream = anthropic.messages.stream(
      { model: CLAUDE_MODEL_FALLBACK, ...params },
      { signal: fallbackSignal },
    );
    return { stream, modelUsed: CLAUDE_MODEL_FALLBACK };
  }
}

// KEISHA_SYSTEM_PROMPT lives in src/lib/prompts/keisha-system.ts so we can
// wrap it with cache_control: ephemeral (Anthropic prompt caching). That
// prompt is ~4K tokens and we pay full-price input tokens on every Claude
// call if uncached; caching drops cached reads to ~10% of a write and
// persists ~5 min. See generateBriefing + generateAnalysis below.
import { KEISHA_SYSTEM_PROMPT, cachedSystem } from './prompts';
export { KEISHA_SYSTEM_PROMPT };

export async function generateBriefing(portfolioContext: string): Promise<string> {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const message = await anthropic.messages.create(
    {
      model: CLAUDE_MODEL_PRIMARY,
      max_tokens: 1200,
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
    },
    { signal: AbortSignal.timeout(NON_STREAM_TIMEOUT_MS) },
  );

  tagAnthropicCall(message.usage, CLAUDE_MODEL_PRIMARY, { caller: 'generateBriefing' });
  return message.content[0].type === 'text' ? message.content[0].text : '';
}

export async function generateAnalysis(
  query: string,
  portfolioContext: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const dynamicContext = `═══════════════════════════════════════════
  LIVE DATA (as of ${today})
═══════════════════════════════════════════
${portfolioContext}

When answering, always ground your response in the live data above. If certain data points are missing (e.g., market is closed, no positions yet), acknowledge it and work with what you have. Never fabricate numbers.`;

  const response = await anthropic.messages.create(
    {
      model: CLAUDE_MODEL_PRIMARY,
      max_tokens: 4096,
      system: cachedSystem(KEISHA_SYSTEM_PROMPT, dynamicContext),
      messages: conversationHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    },
    { signal: AbortSignal.timeout(NON_STREAM_TIMEOUT_MS) },
  );

  tagAnthropicCall(response.usage, CLAUDE_MODEL_PRIMARY, { caller: 'generateAnalysis' });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}
