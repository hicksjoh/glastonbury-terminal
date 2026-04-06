import { NextRequest } from 'next/server';
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
//  POST Handler — Keisha Supreme (Streaming)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha-stream', 20, 60000);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

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

    // ── Stream response via Anthropic SDK ──────────────────────────────
    const stream = await anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemWithContext,
      messages: conversationHistory,
    });

    // Create a ReadableStream that emits SSE events
    const encoder = new TextEncoder();
    let fullResponse = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const text = event.delta.text;
              fullResponse += text;

              // Don't stream the <suggestions> block to the client — buffer it
              // We check if we're inside a suggestions tag
              if (!fullResponse.includes('<suggestions>')) {
                // Not yet in suggestions block, stream normally
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
                );
              }
              // If we've entered the suggestions block, don't stream those chars
              // They'll be parsed and sent as a final event
            }
          }

          // ── Parse suggestions and actions from the full response ─────────
          const { cleanText: textWithoutSuggestions, suggestions } = parseSuggestions(fullResponse);
          const { cleanText, actions } = parseActions(textWithoutSuggestions);

          // ── Execute safe actions, hold dangerous ones for confirmation ──
          const DANGEROUS_ACTIONS = new Set(['place_order']);

          if (actions.length > 0) {
            const actionBaseUrl = process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : 'http://localhost:3000';

            for (const action of actions) {
              if (DANGEROUS_ACTIONS.has(action.type)) {
                // Send as pending confirmation — NOT auto-executed
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    pendingConfirmation: {
                      type: action.type,
                      params: action.params,
                    }
                  })}\n\n`)
                );
                continue;
              }
              try {
                const actionRes = await fetch(`${actionBaseUrl}/api/keisha/actions`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: action.type, params: action.params }),
                });
                const actionData = await actionRes.json();
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    action: {
                      type: action.type,
                      params: action.params,
                      result: actionData,
                      success: actionRes.ok,
                    }
                  })}\n\n`)
                );
              } catch (err) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    action: {
                      type: action.type,
                      params: action.params,
                      result: { error: 'Action failed' },
                      success: false,
                    }
                  })}\n\n`)
                );
              }
            }
          }

          // ── Detect trade intent ───────────────────────────────────────────
          const tradeCard = await detectTradeIntent(cleanText);
          if (tradeCard) {
            // Parse the trade card for structured data
            const tradeMatch = tradeCard.match(/TRADE DETECTED: (\w+) (\w+)/);
            if (tradeMatch) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  trade: {
                    action: tradeMatch[1],
                    symbol: tradeMatch[2],
                    card: tradeCard,
                  }
                })}\n\n`)
              );
            }
          }

          // ── Send suggestions as final event ──────────────────────────────
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              done: true,
              suggestions: suggestions.length > 0 ? suggestions : undefined,
            })}\n\n`)
          );

          // ── Background: log recommendation + conversation ──────────────
          logRecommendation(supabase, cleanText).catch(() => {});
          logConversation(supabase, userMessage, cleanText).catch(() => {});

          controller.close();
        } catch (err) {
          console.error('Stream error:', err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              error: err instanceof Error ? err.message : 'Stream error',
            })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha Stream API error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
