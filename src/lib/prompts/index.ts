// Prompt library — cache-aware helpers for Anthropic SDK calls.
//
// Why this exists:
//   The KEISHA system prompt is ~3.5K tokens and is sent on every Claude
//   call (briefing cron, Keisha chat, agents). Without prompt caching that's
//   full-price input tokens every time. With Anthropic's cache_control marker,
//   cached reads cost ~10% of a write and persist ~5 min — across calls in
//   the same conversation AND across separate requests.
//
//   For Keisha chat (many messages per session) this saves most of the
//   system-prompt cost. For the once-a-day briefing cron it still writes
//   the cache so any interactive chat within 5 min gets the discount.
//
// Usage:
//   import { cachedSystem, KEISHA_SYSTEM_PROMPT } from '@/lib/prompts';
//   anthropic.messages.create({
//     model: ...,
//     system: cachedSystem(KEISHA_SYSTEM_PROMPT),
//     messages: [...],
//   });

import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages';

export { KEISHA_SYSTEM_PROMPT } from './keisha-system';

// The Anthropic SDK at v0.24 does not yet have `cache_control` on its
// exported TextBlockParam type — the API accepts it at runtime but TS
// types lag. We augment here so callers get a correctly-shaped array.
export type CachedTextBlock = TextBlockParam & {
  cache_control?: { type: 'ephemeral' };
};

/**
 * Wraps a system prompt in the Anthropic cache_control format.
 * Returns an array of content blocks suitable for the `system` field of
 * `anthropic.messages.create()`. The first block is marked with
 * `cache_control: ephemeral` so subsequent calls within ~5 minutes reuse
 * the cached prefix at ~10% the cost of a fresh write.
 *
 * Optional second block: dynamic context (live portfolio data, user prefs)
 * that should NOT be cached. Place ONLY content that changes per request here.
 */
export function cachedSystem(
  staticText: string,
  dynamicText?: string,
): CachedTextBlock[] {
  const blocks: CachedTextBlock[] = [
    { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
  ];
  if (dynamicText && dynamicText.length > 0) {
    blocks.push({ type: 'text', text: dynamicText });
  }
  return blocks;
}
