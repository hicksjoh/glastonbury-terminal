import { NextRequest } from 'next/server';
import { KEISHA_SYSTEM_PROMPT } from '@/lib/claude';
import { cachedSystem } from '@/lib/prompts';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { sanitizeInput } from '@/lib/sanitize';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';
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
//  Action Button Helpers (streaming-only UX)
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
      return [];
    case 'lookup_options':
      // No place_order shortcut here — covered-call decisions need to go
      // through Keisha's agent so the trade is guarded, sized, and lands
      // a proper pending-order confirmation. A bare {symbol, side} button
      // would skip all of that.
      return [];
    default:
      return [];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Keisha Supreme (SSE streaming, shared agent loop)
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/stream' });

  // P0-6: durable, session-keyed limit. Streaming Anthropic calls are the
  // single most expensive route in the app — capping at 10 / 5 min per
  // session prevents wallet runaway across warm Vercel instances.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('keisha-stream', key, 10, 300);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Gemini round-3 P0: tie the upstream Anthropic call to the client's
  // lifetime. Without this, if the browser tab closes mid-stream the
  // generation keeps running on Vercel and we keep paying for tokens
  // nobody will ever see. ReadableStream.cancel() fires when the client
  // disconnects; outer-catch aborts on unexpected failure paths too.
  const agentAbort = new AbortController();

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

    // Split into cached static block + dynamic context so Anthropic prompt
    // caching (cache_control: ephemeral on the static block) can kick in
    // across sequential Keisha streaming messages.
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
- For non-destructive tools (lookups, watchlist, alerts), execute immediately when relevant
- TAX TOOLS: Use get_tax_estimate, check_wash_sale, get_harvest_candidates, compare_tax_lots, get_holding_periods, calculate_section_1256, get_tax_suggestions, export_tax_report, and calculate_business_deductions for any tax-related questions
- When Wes asks about exporting trades or "send to my CPA", use export_tax_report
- When Wes asks about business deductions (mileage, home office, Section 179, SEP-IRA), use calculate_business_deductions

TAX AWARENESS (applies in all modes):
Before any trade recommendation, silently check:
- Would this trigger a wash sale? (use check_wash_sale)
- Is this position close to long-term status? (use get_holding_periods)
- Are there tax-loss harvesting opportunities? (use get_harvest_candidates)
If any apply, mention it briefly in your response.${domain === 'tax' ? `

═══════════════════════════════════════════
  TAX ADVISOR MODE
═══════════════════════════════════════════
You are Keisha in Tax Advisor mode. You have access to the full US Tax Code (2025 tax year data) and can run real calculations. ALWAYS use your tax tools to calculate — never estimate from memory.

Key capabilities:
- Calculate income tax, capital gains tax, NIIT, and AMT
- Detect wash sales before they happen
- Find tax-loss harvesting opportunities with replacement suggestions
- Compare tax lot selection methods (FIFO/LIFO/HIFO)
- Track holding periods and long-term conversion dates
- Calculate Section 1256 (60/40) treatment for futures/options
- Generate quarterly estimated tax payments
- Provide proactive tax optimization suggestions

IMPORTANT RULES:
1. Always append the tax disclaimer to your response: "Tax estimates are for educational and planning purposes only. This is NOT tax advice. Consult a qualified tax professional (CPA or EA) for your specific situation."
2. Never say "I recommend" — say "One approach to consider" or "The math shows"
3. Always show your work with specific numbers
4. If asked about state tax, note that you only calculate federal
5. If asked about something beyond tax math (legal interpretation, audit risk), say "That's beyond tax math — talk to your CPA"
6. Proactively surface tax suggestions when you see opportunities` : ''}${buildPreferencesBlock(settings as KeishaSettings | undefined)}`;

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

    // ── SSE Stream ────────────────────────────────────────────────────
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const { finalText, suggestions } = await runKeishaAgent({
            messages: conversationHistory,
            system: cachedSystem(KEISHA_SYSTEM_PROMPT, dynamicContext),
            signal: agentAbort.signal,
            createPendingConfirmation: (p) =>
              createPendingOrder(supabase, {
                toolName: p.type,
                params: p.params,
                conversationId: conversationId ?? null,
              }),
            onTextDelta: (text) => send({ text }),
            onToolStart: () => send({ toolsRunning: true }),
            onToolResult: (action) => {
              send({
                action: { type: action.type, params: action.input, result: action.result, success: action.success },
                ...(action.renderCard ? { renderCard: action.renderCard } : {}),
              });
              const buttons = getActionButtons(action.type, action.input, action.result);
              if (buttons.length > 0) send({ actionButtons: buttons });
            },
            onPendingConfirmation: (pending) => {
              send({ pendingConfirmation: pending });
            },
          });

          send({
            done: true,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
          });

          // ── Background logging ──────────────────────────────────────
          logRecommendation(supabase, finalText).catch(() => {});
          logConversation(supabase, userMessage, finalText).catch(() => {});

          controller.close();
        } catch (err) {
          const eventId = captureRouteError(err, { request_id, route: 'keisha/stream', stage: 'agent_run' });
          log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'keisha stream agent threw');
          // Don't leak raw err.message into the SSE stream — generic message + eventId.
          send({ error: 'Stream error', sentry_event_id: eventId });
          // Belt-and-braces: cut the upstream Anthropic call if it's still running.
          agentAbort.abort('keisha stream agent threw');
          controller.close();
        }
      },
      cancel(reason) {
        // Client disconnected (browser tab closed, network drop). Kill the
        // upstream Anthropic call so we stop paying for tokens nobody will see.
        agentAbort.abort(reason ?? 'client disconnected');
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
    const eventId = captureRouteError(error, { request_id, route: 'keisha/stream', stage: 'setup' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'keisha stream setup failed');
    // If we never reached the ReadableStream the controller is dangling — abort
    // it explicitly so any straggler reference doesn't keep an Anthropic call alive.
    agentAbort.abort('keisha stream setup failed');
    return new Response(
      JSON.stringify({ error: 'Stream setup failed', sentry_event_id: eventId }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
