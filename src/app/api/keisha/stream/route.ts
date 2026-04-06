import { NextRequest } from 'next/server';
import { anthropic, KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeInput } from '@/lib/sanitize';
import {
  buildFullPortfolioContext,
  detectTradeIntent,
  logRecommendation,
  logConversation,
} from '@/lib/keisha-context';
import {
  KEISHA_TOOLS,
  DANGEROUS_TOOLS,
  MAX_TOOL_ITERATIONS,
  executeToolCall,
} from '@/lib/keisha-tools';
import type { MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Keisha Supreme (Streaming + Tool Use + Agentic Loop)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha-stream', 20, 60000);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const { messages, domain, conversationId } = await req.json();
    const userMessage = sanitizeInput(messages[messages.length - 1]?.content || '');

    // ── Build context ─────────────────────────────────────────────────
    const { portfolioContext, supabase } = await buildFullPortfolioContext({
      userMessage,
      domain: domain || '',
      conversationId,
      messages,
    });

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const systemWithContext = `${KEISHA_SYSTEM_PROMPT}

═══════════════════════════════════════════
  LIVE DATA (as of ${today})
═══════════════════════════════════════════
${portfolioContext}

When answering, always ground your response in the live data above. If certain data points are missing (e.g., market is closed, no positions yet), acknowledge it and work with what you have. Never fabricate numbers.

TOOL USAGE RULES:
- Use lookup_price and get_position to fetch real-time data BEFORE giving analysis
- Chain multiple lookups when comparing stocks or building a thesis
- Always call suggest_followups at the END of your response with 3 relevant follow-up questions
- For orders (place_order), ONLY use the tool when Wes explicitly asks to buy or sell
- For non-destructive tools (lookups, watchlist, alerts), execute immediately when relevant`;

    const conversationHistory: MessageParam[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }),
    );

    // ── SSE Stream ────────────────────────────────────────────────────
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          let currentMessages = [...conversationHistory];
          let fullText = '';
          let suggestions: string[] = [];

          for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
            // ── Run agentic iteration ─────────────────────────────────
            const isLastPossibleIteration = iteration === MAX_TOOL_ITERATIONS - 1;

            const stream = await anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 4096,
              system: systemWithContext,
              messages: currentMessages,
              tools: KEISHA_TOOLS,
            });

            // Collect tool_use blocks from this iteration
            const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
            let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
            let iterationText = '';
            let stopReason = '';

            for await (const event of stream) {
              // Stream text deltas to client in real-time
              if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  const text = event.delta.text;
                  iterationText += text;
                  fullText += text;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
                  );
                }
                // Accumulate tool input JSON
                if (event.delta.type === 'input_json_delta' && currentToolBlock) {
                  currentToolBlock.inputJson += event.delta.partial_json;
                }
              }

              // Track tool_use block starts
              if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                currentToolBlock = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  inputJson: '',
                };
              }

              // Tool block complete
              if (event.type === 'content_block_stop' && currentToolBlock) {
                try {
                  const input = JSON.parse(currentToolBlock.inputJson || '{}');
                  toolUseBlocks.push({
                    id: currentToolBlock.id,
                    name: currentToolBlock.name,
                    input,
                  });
                } catch {
                  toolUseBlocks.push({
                    id: currentToolBlock.id,
                    name: currentToolBlock.name,
                    input: {},
                  });
                }
                currentToolBlock = null;
              }

              if (event.type === 'message_delta') {
                stopReason = (event as any).delta?.stop_reason || '';
              }
            }

            // ── No tool calls — done ──────────────────────────────────
            if (toolUseBlocks.length === 0) break;

            // ── Process tool calls ────────────────────────────────────
            // Notify client that tools are being executed
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ toolsRunning: true })}\n\n`),
            );

            const assistantContent: any[] = [];
            if (iterationText) {
              assistantContent.push({ type: 'text', text: iterationText });
            }
            for (const tb of toolUseBlocks) {
              assistantContent.push({
                type: 'tool_use',
                id: tb.id,
                name: tb.name,
                input: tb.input,
              } as any);
            }

            const toolResults: any[] = [];

            for (const tb of toolUseBlocks) {
              // suggest_followups — not a real action
              if (tb.name === 'suggest_followups') {
                const sugs = tb.input.suggestions;
                if (Array.isArray(sugs)) {
                  suggestions = sugs.map(s => String(s)).slice(0, 3);
                }
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: tb.id,
                  content: 'Suggestions noted.',
                } as any);
                continue;
              }

              // Dangerous tools — pending confirmation
              if (DANGEROUS_TOOLS.has(tb.name)) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    pendingConfirmation: { type: tb.name, params: tb.input },
                  })}\n\n`),
                );
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: tb.id,
                  content: JSON.stringify({
                    pending: true,
                    message: `Order requires Wes's confirmation. A confirmation prompt has been sent to the UI.`,
                  }),
                } as any);
                continue;
              }

              // Execute safe tool
              const { result, success } = await executeToolCall(tb.name, tb.input);

              // Stream action result to client
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  action: { type: tb.name, params: tb.input, result, success },
                })}\n\n`),
              );

              toolResults.push({
                type: 'tool_result',
                tool_use_id: tb.id,
                content: JSON.stringify(result),
              } as any);
            }

            // ── Feed results back for next iteration ──────────────────
            currentMessages = [
              ...currentMessages,
              { role: 'assistant' as const, content: assistantContent },
              { role: 'user' as const, content: toolResults },
            ];

            // If this was the last possible turn or end_turn, break
            if (stopReason === 'end_turn' || isLastPossibleIteration) break;
          }

          // ── Detect trade intent ─────────────────────────────────────
          const tradeCard = await detectTradeIntent(fullText);
          if (tradeCard) {
            const tradeMatch = tradeCard.match(/TRADE DETECTED: (\w+) (\w+)/);
            if (tradeMatch) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  trade: {
                    action: tradeMatch[1],
                    symbol: tradeMatch[2],
                    card: tradeCard,
                  },
                })}\n\n`),
              );
            }
          }

          // ── Send done event with suggestions ────────────────────────
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              done: true,
              suggestions: suggestions.length > 0 ? suggestions : undefined,
            })}\n\n`),
          );

          // ── Background logging ──────────────────────────────────────
          logRecommendation(supabase, fullText).catch(() => {});
          logConversation(supabase, userMessage, fullText).catch(() => {});

          controller.close();
        } catch (err) {
          console.error('Stream error:', err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              error: err instanceof Error ? err.message : 'Stream error',
            })}\n\n`),
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
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
