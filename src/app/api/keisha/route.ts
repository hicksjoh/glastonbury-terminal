import { NextRequest, NextResponse } from 'next/server';
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
import type { MessageParam, TextBlockParam, ToolUseBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';

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
//  POST Handler — Keisha Supreme (Tool Use + Agentic Loop)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('keisha', 20, 60000);
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
        ] as any;
      }
    }

    // ── Agentic Loop — iterate until Claude gives a final text response ─
    let currentMessages = [...conversationHistory];
    const actionResults: { type: string; result: unknown; success: boolean }[] = [];
    const pendingConfirmations: { type: string; params: Record<string, unknown> }[] = [];
    let suggestions: string[] = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: systemWithContext,
        messages: currentMessages,
        tools: KEISHA_TOOLS,
      });

      // ── Extract text and tool_use blocks ────────────────────────────
      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      // Accumulate text
      for (const block of textBlocks) {
        if (block.type === 'text') finalText += block.text;
      }

      // No tool calls — we're done
      if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
        // If stop_reason is end_turn but there are tool blocks, process them first
        if (toolBlocks.length === 0) break;
      }

      // ── Process tool calls ──────────────────────────────────────────
      const toolResults: ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        if (block.type !== 'tool_use') continue;
        const { id, name, input } = block;
        const toolInput = input as Record<string, unknown>;

        // Handle suggest_followups (not a real action)
        if (name === 'suggest_followups') {
          const sugs = toolInput.suggestions;
          if (Array.isArray(sugs)) {
            suggestions = sugs.map(s => String(s)).slice(0, 3);
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: 'Suggestions noted.',
          } as unknown as ToolResultBlockParam);
          continue;
        }

        // Handle dangerous tools — don't execute, return as pending
        if (DANGEROUS_TOOLS.has(name)) {
          pendingConfirmations.push({ type: name, params: toolInput });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: JSON.stringify({
              pending: true,
              message: `Order requires Wes's confirmation. A confirmation prompt has been sent to the UI.`,
            }),
          } as unknown as ToolResultBlockParam);
          continue;
        }

        // Execute safe tools
        const { result, success } = await executeToolCall(name, toolInput);
        actionResults.push({ type: name, result, success });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify(result),
        } as unknown as ToolResultBlockParam);
      }

      // ── Feed results back for next iteration ────────────────────────
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: response.content as any },
        { role: 'user' as const, content: toolResults as any },
      ];

      // If stop_reason was end_turn (text + tools in same response), break after processing
      if (response.stop_reason === 'end_turn') break;
    }

    // ── Background logging ─────────────────────────────────────────────
    logRecommendation(supabase, finalText).catch(() => {});
    logConversation(supabase, userMessage, finalText).catch(() => {});

    return NextResponse.json({
      content: finalText,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      actions: actionResults.length > 0 ? actionResults : undefined,
      pendingConfirmations: pendingConfirmations.length > 0 ? pendingConfirmations : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
