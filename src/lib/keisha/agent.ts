// Shared agentic loop for Keisha.
//
// Both /api/keisha (JSON response) and /api/keisha/stream (SSE) share the
// same tool-calling loop. Keeping it in one place stops the routes from
// drifting (which they were already doing — see the duplicated tool-rule
// blocks before this refactor).
//
// Implementation note: we always use anthropic.beta.messages.stream() under
// the hood (beta surface for the refusal-fallback opt-in). Streaming consumers wire up real-time hooks; non-streaming consumers
// just await the final result. One code path, zero divergence.

import { anthropic, CLAUDE_MODEL_PRIMARY, modelBudget } from '@/lib/claude';
import {
  KEISHA_TOOLS,
  DANGEROUS_TOOLS,
  MAX_TOOL_ITERATIONS,
  executeToolCall,
  buildRenderCard,
} from '@/lib/keisha-tools';
import type {
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTextBlock,
  BetaTextBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages';
import type { CachedTextBlock } from '@/lib/prompts';
import { tagAnthropicCall } from '@/lib/anthropic-cost';

export interface KeishaAgentAction {
  type: string;
  input: Record<string, unknown>;
  result: unknown;
  success: boolean;
  renderCard?: unknown;
}

export interface KeishaAgentPending {
  type: string;
  params: Record<string, unknown>;
  /** Server-issued id once the pending order has been persisted. */
  id?: string;
  /** ISO expiry of the pending order. */
  expiresAt?: string;
}

export interface KeishaAgentHooks {
  onTextDelta?: (text: string) => void;
  onToolStart?: () => void;
  onToolResult?: (action: KeishaAgentAction) => void;
  onPendingConfirmation?: (pending: KeishaAgentPending) => void;
  /**
   * Persist a dangerous tool call server-side and return a public id +
   * expiry. The agent passes the result through to onPendingConfirmation
   * so the UI confirms by id, not by raw params. Routes that don't supply
   * this hook will surface `id`-less pending confirmations, which the
   * /api/keisha/actions endpoint will reject — that's the safe default.
   */
  createPendingConfirmation?: (
    pending: { type: string; params: Record<string, unknown> },
  ) => Promise<{ id: string; expiresAt: string }>;
}

export interface KeishaAgentInput extends KeishaAgentHooks {
  messages: MessageParam[];
  system: CachedTextBlock[];
  /**
   * Hard cap on cumulative tokens (input + cache + output) across all
   * iterations of the agentic loop. When exceeded, the loop stops and
   * returns whatever synthesis is in hand. Defaults to 120_000.
   *
   * Sizing: the cached system prompt + tool definitions are ~15K tokens
   * and are re-read (as cache reads, which count here) on every iteration,
   * so a normal 3-tool turn already lands near 45K. The cap sits above a
   * full MAX_TOOL_ITERATIONS run so it only fires on a real runaway.
   *
   * The research agent already has cost controls; chat did not. This is
   * the chat equivalent — prevents runaway cost on a single conversation
   * if Claude gets stuck calling tools in a circle.
   */
  maxTotalTokens?: number;
}

export const DEFAULT_KEISHA_TOKEN_BUDGET = 120_000;

const REFUSAL_REPLY = "I can't help with that one. Ask me another way, or about something else.";
const TRUNCATED_REPLY = 'I ran out of room before I could finish that. Ask me again and I will keep it tighter.';

// Models with safety classifiers can decline a request (stop_reason
// "refusal"). Opting in to server-side fallbacks lets the API re-run a
// declined request on Anthropic's recommended substitute inside the same
// call, instead of handing Wes a dead turn on a false positive.
function refusalFallback(model: string): { betas?: ['server-side-fallback-2026-07-01']; fallbacks?: 'default' } {
  if (!/^claude-(fable-5|opus-5|sonnet-5-5)/.test(model)) return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

/**
 * The content to send back as the assistant turn. Normally that is the
 * message exactly as received. If a fallback model took over mid-output,
 * the blocks the declined model produced before the hand-off (its thinking
 * and tool calls) are not replayable — only its text is.
 */
function echoableContent(content: BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.map(b => b.type).lastIndexOf('fallback');
  if (boundary === -1) return content;
  return content.filter((b, i) => i > boundary || b.type === 'text');
}

export interface KeishaAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  iterations: number;
  /** True if the loop stopped early because the budget was exceeded. */
  budgetExceeded: boolean;
}

export interface KeishaAgentOutput {
  finalText: string;
  suggestions: string[];
  actions: KeishaAgentAction[];
  pendingConfirmations: KeishaAgentPending[];
  usage: KeishaAgentUsage;
}

export async function runKeishaAgent(input: KeishaAgentInput): Promise<KeishaAgentOutput> {
  const {
    messages,
    system,
    onTextDelta,
    onToolStart,
    onToolResult,
    onPendingConfirmation,
  } = input;
  const maxTotalTokens = input.maxTotalTokens ?? DEFAULT_KEISHA_TOKEN_BUDGET;

  let currentMessages: MessageParam[] = [...messages];
  let finalText = '';
  let suggestions: string[] = [];
  const actions: KeishaAgentAction[] = [];
  const pendingConfirmations: KeishaAgentPending[] = [];
  const usage: KeishaAgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    iterations: 0,
    budgetExceeded: false,
  };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = anthropic.beta.messages.stream({
      model: CLAUDE_MODEL_PRIMARY,
      ...modelBudget(CLAUDE_MODEL_PRIMARY, 4096),
      system: system as BetaTextBlockParam[],
      messages: currentMessages as BetaMessageParam[],
      tools: KEISHA_TOOLS,
      ...refusalFallback(CLAUDE_MODEL_PRIMARY),
    });

    usage.iterations += 1;

    stream.on('text', (text: string) => onTextDelta?.(text));
    const message = await stream.finalMessage();

    // usage covers the attempt that produced this message. We accumulate
    // across iterations to enforce the budget.
    usage.inputTokens += message.usage.input_tokens ?? 0;
    usage.outputTokens += message.usage.output_tokens ?? 0;
    usage.cacheCreationTokens += message.usage.cache_creation_input_tokens ?? 0;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

    // The assistant turn goes back to the API exactly as received:
    // thinking blocks included, unmodified. Rebuilding it from text +
    // tool_use drops the model's reasoning mid-task (and is rejected
    // outright on models that bind thinking to the conversation).
    const assistantContent = echoableContent(message.content);

    const iterationText = assistantContent
      .filter((b): b is BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Use the last iteration's text as the final synthesis. Replacing
    // (rather than concatenating across iterations) keeps intermediate
    // "let me check..." chatter out of the user-visible reply.
    if (iterationText) finalText = iterationText;

    // Safety classifiers declined (and any fallback declined too). There
    // is nothing to act on — never run tools off a refused turn.
    if (message.stop_reason === 'refusal') {
      finalText = REFUSAL_REPLY;
      onTextDelta?.(iterationText ? `\n\n${REFUSAL_REPLY}` : REFUSAL_REPLY);
      break;
    }

    // Cut off mid-turn: a tool_use block here may carry truncated input,
    // so it must not execute. Keep whatever text landed and stop.
    if (message.stop_reason === 'max_tokens') {
      if (!iterationText) {
        finalText = TRUNCATED_REPLY;
        onTextDelta?.(TRUNCATED_REPLY);
      }
      break;
    }

    const toolUseBlocks = assistantContent
      .filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

    if (toolUseBlocks.length === 0) break;

    onToolStart?.();

    const toolResults: ToolResultBlockParam[] = [];

    for (const tb of toolUseBlocks) {
      // suggest_followups is a sentinel tool — it just registers UI suggestions
      if (tb.name === 'suggest_followups') {
        const sugs = tb.input.suggestions;
        if (Array.isArray(sugs)) {
          suggestions = sugs.map(s => String(s)).slice(0, 3);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: 'Suggestions noted.',
        } as unknown as ToolResultBlockParam);
        continue;
      }

      // Dangerous tools (place_order) never execute server-side here. They
      // are persisted in the pending-orders store and surfaced to the UI
      // by id. The /api/keisha/actions endpoint atomically consumes that
      // id and uses the STORED params — never client-supplied ones.
      if (DANGEROUS_TOOLS.has(tb.name)) {
        let persisted: { id: string; expiresAt: string } | undefined;
        if (input.createPendingConfirmation) {
          try {
            persisted = await input.createPendingConfirmation({
              type: tb.name,
              params: tb.input,
            });
          } catch (err) {
            console.error('Failed to persist pending order:', err);
          }
        }
        const pending: KeishaAgentPending = {
          type: tb.name,
          params: tb.input,
          ...(persisted ?? {}),
        };
        pendingConfirmations.push(pending);
        onPendingConfirmation?.(pending);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify({
            pending: true,
            pendingOrderId: persisted?.id,
            message: `Order requires Wes's confirmation. A confirmation prompt has been sent to the UI.`,
          }),
        } as unknown as ToolResultBlockParam);
        continue;
      }

      const { result, success } = await executeToolCall(tb.name, tb.input);
      const renderCard = buildRenderCard(tb.name, tb.input, result, success);
      const action: KeishaAgentAction = {
        type: tb.name,
        input: tb.input,
        result,
        success,
        ...(renderCard ? { renderCard } : {}),
      };
      actions.push(action);
      onToolResult?.(action);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: JSON.stringify(result),
      } as unknown as ToolResultBlockParam);
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: assistantContent as unknown as MessageParam['content'] },
      { role: 'user', content: toolResults as unknown as MessageParam['content'] },
    ];

    // Budget check — sum of input + cache + output across iterations.
    // Cache reads count because they are still billed (at a discount), and
    // a runaway loop accumulates those too. Cache creation is the priciest
    // bucket so we definitely include it.
    const totalUsed =
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheCreationTokens +
      usage.cacheReadTokens;
    if (totalUsed >= maxTotalTokens) {
      usage.budgetExceeded = true;
      break;
    }
  }

  // p6-12: tag the cumulative Anthropic spend for this whole agent run.
  // Per-iteration tagging would be more granular but the agent's stream
  // event loop accumulates usage across iterations directly into `usage` —
  // tagging once at the end with the totals is correct and gives Sentry
  // alert visibility for what is otherwise the most invisible spend path
  // (Keisha tool-use loop can run 5+ iterations per user message).
  tagAnthropicCall(
    {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationTokens,
      cache_read_input_tokens: usage.cacheReadTokens,
    },
    CLAUDE_MODEL_PRIMARY,
    { caller: 'keisha-agent', iterations: usage.iterations },
  );

  return { finalText, suggestions, actions, pendingConfirmations, usage };
}
