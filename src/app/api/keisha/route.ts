import { NextRequest, NextResponse } from 'next/server';
import { KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { cachedSystem } from '@/lib/prompts';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { sanitizeInput } from '@/lib/sanitize';
import {
  buildFullPortfolioContext,
  logRecommendation,
  logConversation,
} from '@/lib/keisha-context';
import { runKeishaAgent } from '@/lib/keisha/agent';
import { buildPreferencesBlock, type KeishaSettings } from '@/lib/keisha/preferences';
import { createPendingOrder } from '@/lib/keisha/pending-orders';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Keisha Supreme (JSON response, shared agent loop)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  // P0-6 (hardening/p0-codex-fixes): durable, session-keyed limit. Was a
  // module-level Map per Vercel instance — across N warm workers, the
  // effective Anthropic budget was N×declared. Durable RPC clamps it for
  // real. 30 req / 5 min matches the prompt's spec.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('keisha', key, 30, 300);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const { messages, domain, conversationId, settings, image } = await req.json();
    const userMessage = sanitizeInput(messages[messages.length - 1]?.content || '');

    // ── Build context using shared module with smart pruning ──────────
    const { portfolioContext, supabase } = await buildFullPortfolioContext({
      userMessage,
      domain: domain || '',
      conversationId,
      messages,
    });

    // ── Build system prompt with context ────────────────────────────────
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Split into cached static block + dynamic context so Anthropic prompt
    // caching (cache_control: ephemeral on the static block) can kick in
    // across sequential Keisha messages.
    const dynamicContext = `═══════════════════════════════════════════
  LIVE DATA (as of ${today})
═══════════════════════════════════════════
${portfolioContext}

When answering, always ground your response in the live data above. If certain data points are missing (e.g., market is closed, no positions yet), acknowledge it and work with what you have. Never fabricate numbers.

TOOL USAGE RULES:
- Use lookup_price and get_position to fetch real-time data BEFORE giving analysis
- Chain multiple lookups when comparing stocks or building a thesis
- Always call suggest_followups at the END of your response with 3 relevant follow-up questions
- For orders (place_order), ONLY use the tool when Wes explicitly asks to buy or sell
- ALWAYS call check_trade_guard BEFORE suggesting or placing any order — show the guard results to Wes
- If check_trade_guard returns STOP, strongly advise against the trade and explain why
- If check_trade_guard returns CAUTION, present the warnings clearly and let Wes decide
- For non-destructive tools (lookups, watchlist, alerts), execute immediately when relevant${buildPreferencesBlock(settings as KeishaSettings | undefined)}`;

    // ── Build conversation history ─────────────────────────────────────
    const conversationHistory: MessageParam[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }),
    );

    // ── Vision / Image Upload ─────────────────────────────────────────
    if (image) {
      const lastMsg = conversationHistory[conversationHistory.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content = [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : '' },
        ] as unknown as MessageParam['content'];
      }
    }

    // ── Run agentic loop via shared module ──────────────────────────────
    const { finalText, suggestions, actions, pendingConfirmations } = await runKeishaAgent({
      messages: conversationHistory,
      system: cachedSystem(KEISHA_SYSTEM_PROMPT, dynamicContext),
      createPendingConfirmation: (p) =>
        createPendingOrder(supabase, {
          toolName: p.type,
          params: p.params,
          conversationId: conversationId ?? null,
        }),
    });

    // ── Background logging ─────────────────────────────────────────────
    logRecommendation(supabase, finalText).catch(() => {});
    logConversation(supabase, userMessage, finalText).catch(() => {});

    return NextResponse.json({
      content: finalText,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      actions: actions.length > 0
        ? actions.map(a => ({ type: a.type, result: a.result, success: a.success, ...(a.renderCard ? { renderCard: a.renderCard } : {}) }))
        : undefined,
      pendingConfirmations: pendingConfirmations.length > 0 ? pendingConfirmations : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
