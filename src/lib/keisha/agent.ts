// Shared agentic loop for Keisha.
//
// Both /api/keisha (JSON response) and /api/keisha/stream (SSE) share the
// same tool-calling loop. Keeping it in one place stops the routes from
// drifting (which they were already doing — see the duplicated tool-rule
// blocks before this refactor).
//
// Implementation note: we always use anthropic.messages.stream() under the
// hood. Streaming consumers wire up real-time hooks; non-streaming consumers
// just await the final result. One code path, zero divergence.

import { anthropic, CLAUDE_MODEL_PRIMARY } from '@/lib/claude';
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
import type { CachedTextBlock } from '@/lib/prompts';

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
}

export interface KeishaAgentOutput {
  finalText: string;
  suggestions: string[];
  actions: KeishaAgentAction[];
  pendingConfirmations: KeishaAgentPending[];
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

  let currentMessages: MessageParam[] = [...messages];
  let finalText = '';
  let suggestions: string[] = [];
  const actions: KeishaAgentAction[] = [];
  const pendingConfirmations: KeishaAgentPending[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = await anthropic.messages.stream({
      model: CLAUDE_MODEL_PRIMARY,
      max_tokens: 4096,
      system: system as unknown as string,
      messages: currentMessages,
      tools: KEISHA_TOOLS,
    });

    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
    let iterationText = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        currentToolBlock = {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: '',
        };
      }

      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const text = event.delta.text;
          iterationText += text;
          onTextDelta?.(text);
        }
        if (event.delta.type === 'input_json_delta' && currentToolBlock) {
          currentToolBlock.inputJson += event.delta.partial_json;
        }
      }

      if (event.type === 'content_block_stop' && currentToolBlock) {
        try {
          const parsed = JSON.parse(currentToolBlock.inputJson || '{}') as Record<string, unknown>;
          toolUseBlocks.push({
            id: currentToolBlock.id,
            name: currentToolBlock.name,
            input: parsed,
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
    }

    // Use the last iteration's text as the final synthesis. Replacing
    // (rather than concatenating across iterations) keeps intermediate
    // "let me check..." chatter out of the user-visible reply.
    if (iterationText) finalText = iterationText;

    if (toolUseBlocks.length === 0) break;

    onToolStart?.();

    const assistantContent: Array<Record<string, unknown>> = [];
    if (iterationText) assistantContent.push({ type: 'text', text: iterationText });
    for (const tb of toolUseBlocks) {
      assistantContent.push({
        type: 'tool_use',
        id: tb.id,
        name: tb.name,
        input: tb.input,
      });
    }

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
  }

  return { finalText, suggestions, actions, pendingConfirmations };
}
