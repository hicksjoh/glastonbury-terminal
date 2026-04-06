import { NextRequest, NextResponse } from 'next/server';
import { anthropic, KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeInput } from '@/lib/sanitize';
import {
  buildFullPortfolioContext,
  detectTradeIntent,
  logRecommendation,
  logConversation,
  parseSuggestions,
  parseActions,
  SUGGESTION_PROMPT_SUFFIX,
  ACTION_PROMPT_SUFFIX,
} from '@/lib/keisha-context';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Keisha Supreme
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha', 20, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const { messages, domain, conversationId } = await req.json();
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
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const systemWithContext = `${KEISHA_SYSTEM_PROMPT}

═══════════════════════════════════════════
  LIVE DATA (as of ${today})
═══════════════════════════════════════════
${portfolioContext}

When answering, always ground your response in the live data above. If certain data points are missing (e.g., market is closed, no positions yet), acknowledge it and work with what you have. Never fabricate numbers.${ACTION_PROMPT_SUFFIX}${SUGGESTION_PROMPT_SUFFIX}`;

    // ── Build conversation history ─────────────────────────────────────
    const conversationHistory = messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // ── Generate response ───────────────────────────────────────────────
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemWithContext,
      messages: conversationHistory,
    });

    const rawContent = response.content[0].type === 'text' ? response.content[0].text : '';

    // ── Parse suggestions and actions from response ───────────────────────
    const { cleanText: textWithoutSuggestions, suggestions } = parseSuggestions(rawContent);
    const { cleanText: cleanedContent, actions } = parseActions(textWithoutSuggestions);
    let content = cleanedContent;

    // ── Execute any actions Keisha included ──────────────────────────────
    const actionResults: { type: string; result: any; success: boolean }[] = [];
    if (actions.length > 0) {
      const actionBaseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';
      for (const action of actions) {
        try {
          const actionRes = await fetch(`${actionBaseUrl}/api/keisha/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action.type, params: action.params }),
          });
          const actionData = await actionRes.json();
          actionResults.push({ type: action.type, result: actionData, success: actionRes.ok });
        } catch {
          actionResults.push({ type: action.type, result: { error: 'Action failed' }, success: false });
        }
      }
    }

    // ── Feature 3: NLP Trade Detection (post-processing) ────────────────
    const tradeCard = await detectTradeIntent(content);
    if (tradeCard) {
      content += tradeCard;
    }

    // ── Feature 1 & 6: Log recommendation + conversation (background) ──
    logRecommendation(supabase, content).catch(() => {});
    logConversation(supabase, userMessage, content).catch(() => {});

    return NextResponse.json({ content, suggestions, actions: actionResults.length > 0 ? actionResults : undefined });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
