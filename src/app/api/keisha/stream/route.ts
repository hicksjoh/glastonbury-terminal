import { NextRequest } from 'next/server';
import { anthropic, KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeInput } from '@/lib/sanitize';
import {
  buildFullPortfolioContext,
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
//  Settings → System Prompt Helpers
// ═════════════════════════════════════════════════════════════════════════════

function getRiskLabel(value: number): string {
  if (value <= 33) return 'Conservative';
  if (value <= 66) return 'Moderate';
  return 'Aggressive';
}

function getRiskDescription(value: number): string {
  if (value <= 33) return 'prioritize capital preservation, smaller positions, wide stops';
  if (value <= 66) return 'balanced risk/reward, standard position sizing';
  return 'willing to take bigger positions, tighter stops, higher conviction plays';
}

function getCommStyleInstruction(style: string): string {
  if (style === 'brief') return 'Keep responses concise (under 150 words). Skip preambles. Lead with the answer.';
  return 'Give thorough analysis with supporting data, scenarios, and reasoning.';
}

function buildPreferencesBlock(settings?: { riskTolerance?: number; commStyle?: string; paperMode?: boolean }): string {
  const risk = settings?.riskTolerance ?? 50;
  const style = settings?.commStyle ?? 'detailed';
  const paper = settings?.paperMode ?? true;

  const riskLabel = getRiskLabel(risk);
  const riskDesc = getRiskDescription(risk);
  const commInstruction = getCommStyleInstruction(style);
  const modeLabel = paper ? 'paper' : 'live';
  const modeWarning = paper ? '' : ' — LIVE TRADING ENABLED. Double-confirm all orders with Wes before execution.';

  return `
USER PREFERENCES:
- Risk Tolerance: ${riskLabel} (${risk}/100) — ${riskDesc}
- Communication Style: ${style} — ${commInstruction}
- Trading Mode: ${modeLabel}${modeWarning}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  Action Button Helpers
// ═════════════════════════════════════════════════════════════════════════════

function getActionButtons(
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
): Array<{ label: string; action: string; params: Record<string, unknown> }> {
  const sym = String(input.symbol || '');
  switch (tool) {
    case 'lookup_price':
      return sym ? [
        { label: `Add ${sym} to Watchlist`, action: 'add_watchlist', params: { symbol: sym } },
        { label: `Set Alert for ${sym}`, action: 'set_alert', params: { symbol: sym } },
        { label: `Options Chain for ${sym}`, action: 'lookup_options', params: { symbol: sym } },
      ] : [];
    case 'batch_lookup': {
      // Emit buttons for each symbol in the results
      const buttons: Array<{ label: string; action: string; params: Record<string, unknown> }> = [];
      const symbols: string[] = [];
      if (Array.isArray(input.symbols)) {
        symbols.push(...input.symbols.map(s => String(s)));
      } else if (result && typeof result === 'object') {
        symbols.push(...Object.keys(result as Record<string, unknown>));
      }
      for (const s of symbols) {
        buttons.push(
          { label: `Add ${s} to Watchlist`, action: 'add_watchlist', params: { symbol: s } },
          { label: `Set Alert for ${s}`, action: 'set_alert', params: { symbol: s } },
          { label: `Options Chain for ${s}`, action: 'lookup_options', params: { symbol: s } },
        );
      }
      return buttons;
    }
    case 'portfolio_summary':
      return [
        { label: 'Scan Watchlist', action: 'scan_watchlist', params: {} },
        { label: 'Run Full Briefing', action: '/brief', params: {} },
      ];
    case 'scan_watchlist':
      return []; // The scan results themselves are actionable
    case 'lookup_options':
      return sym ? [
        { label: `Sell Covered Call on ${sym}`, action: 'place_order', params: { symbol: sym, side: 'sell' } },
      ] : [];
    default:
      return [];
  }
}

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
    const { messages, domain, conversationId, settings, image } = await req.json();
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
- For non-destructive tools (lookups, watchlist, alerts), execute immediately when relevant${buildPreferencesBlock(settings)}`;

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
        ] as any;
      }
    }

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

              // Emit contextual action buttons based on the tool that just ran
              const buttons = getActionButtons(tb.name, tb.input, result);
              if (buttons.length > 0) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ actionButtons: buttons })}\n\n`),
                );
              }

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
