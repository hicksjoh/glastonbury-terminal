// Behavioral evals for the Keisha agentic loop.
//
// These tests don't hit Anthropic — they mock the SDK with synthetic
// streaming events and assert the loop behaves correctly under the
// failure modes we care about:
//
//   1. Stops at MAX_TOOL_ITERATIONS (no infinite loop)
//   2. Stops early when the token budget is exceeded
//   3. Dangerous tools (place_order) NEVER call executeToolCall — they
//      route through createPendingConfirmation and surface to the UI
//   4. createPendingConfirmation hook actually fires for dangerous tools
//   5. Safe tools call executeToolCall and emit tool_result back into
//      the conversation
//   6. The final user-visible text is the LAST iteration's text, not a
//      concatenation of "let me check..." chatter from earlier turns
//   7. The loop continues past stop_reason === 'end_turn' if there are
//      tool calls (so the synthesis turn happens)
//
// If any of these break, Keisha is shipping a regression that affects
// either correctness, cost, or security. These are guardrails.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const streamMock = vi.fn();
vi.mock('@/lib/claude', () => ({
  anthropic: {
    beta: {
      messages: {
        stream: (...args: unknown[]) => streamMock(...args),
      },
    },
  },
  CLAUDE_MODEL_PRIMARY: 'mock-model',
  KEISHA_SYSTEM_PROMPT: 'mock-system',
  modelBudget: (_model: string, visibleTokens: number) => ({ max_tokens: visibleTokens }),
}));

const executeToolCallMock = vi.fn();
const buildRenderCardMock = vi.fn();
vi.mock('@/lib/keisha-tools', () => ({
  KEISHA_TOOLS: [],
  DANGEROUS_TOOLS: new Set(['place_order']),
  MAX_TOOL_ITERATIONS: 6,
  executeToolCall: (...args: unknown[]) => executeToolCallMock(...args),
  buildRenderCard: (...args: unknown[]) => buildRenderCardMock(...args),
}));

// Import AFTER mocks so the agent module sees the mocked deps.
let runKeishaAgent: any;
let DEFAULT_KEISHA_TOKEN_BUDGET: any;

beforeEach(async () => {
  vi.resetModules();
  streamMock.mockReset();
  executeToolCallMock.mockReset();
  buildRenderCardMock.mockReset();
  buildRenderCardMock.mockReturnValue(null);
  ({ runKeishaAgent, DEFAULT_KEISHA_TOKEN_BUDGET } = await import('../agent'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Stream helpers ────────────────────────────────────────────────────

interface StreamEvent {
  type: string;
  [key: string]: any;
}

// Mimics the SDK's MessageStream: text deltas fire on the 'text' listener
// and finalMessage() resolves to the accumulated message.
function makeStream(events: StreamEvent[]) {
  const textListeners: Array<(delta: string) => void> = [];
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === 'text') textListeners.push(cb);
      return this;
    },
    async finalMessage() {
      const content: any[] = [];
      const usage: Record<string, number> = { output_tokens: 0 };
      let stop_reason: string | null = null;
      let open: any = null;
      for (const e of events) {
        if (e.type === 'message_start') Object.assign(usage, e.message.usage);
        if (e.type === 'content_block_start') {
          open = { ...e.content_block };
          if (open.type === 'tool_use') open.inputJson = '';
        }
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
          open.text += e.delta.text;
          textListeners.forEach(cb => cb(e.delta.text));
        }
        if (e.type === 'content_block_delta' && e.delta.type === 'input_json_delta') {
          open.inputJson += e.delta.partial_json;
        }
        if (e.type === 'content_block_stop') {
          if (open.type === 'tool_use') {
            if (open.inputJson) open.input = JSON.parse(open.inputJson);
            delete open.inputJson;
          }
          content.push(open);
          open = null;
        }
        if (e.type === 'message_delta') {
          stop_reason = e.delta.stop_reason;
          usage.output_tokens = e.usage.output_tokens;
        }
      }
      return { content, usage, stop_reason, model: 'mock-model' };
    },
  };
}

// A complete (non-delta) block, e.g. a thinking block or a fallback marker.
function wholeBlock(index: number, block: Record<string, unknown>): StreamEvent[] {
  return [
    { type: 'content_block_start', index, content_block: block },
    { type: 'content_block_stop', index },
  ];
}

function textOnlyTurn(text: string, opts: { inputTokens?: number; outputTokens?: number } = {}): StreamEvent[] {
  return [
    { type: 'message_start', message: { usage: { input_tokens: opts.inputTokens ?? 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: opts.outputTokens ?? 50 } },
    { type: 'message_stop' },
  ];
}

function toolUseTurn(args: {
  text?: string;
  toolName: string;
  toolId: string;
  toolInput: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
}): StreamEvent[] {
  const events: StreamEvent[] = [
    { type: 'message_start', message: { usage: { input_tokens: args.inputTokens ?? 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
  ];
  if (args.text) {
    events.push(
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: args.text } },
      { type: 'content_block_stop', index: 0 },
    );
  }
  events.push(
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: args.toolId, name: args.toolName, input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args.toolInput) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: args.outputTokens ?? 80 } },
    { type: 'message_stop' },
  );
  return events;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('runKeishaAgent — basic synthesis', () => {
  it('returns the final iteration text and stops cleanly', async () => {
    streamMock.mockReturnValueOnce(makeStream(textOnlyTurn('Hello Wes.')));

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });

    expect(result.finalText).toBe('Hello Wes.');
    expect(result.actions).toHaveLength(0);
    expect(result.pendingConfirmations).toHaveLength(0);
    expect(result.usage.iterations).toBe(1);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('uses the LAST iteration text, not a concat of intermediate chatter', async () => {
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        text: 'Let me check that...',
        toolName: 'lookup_price',
        toolId: 't1',
        toolInput: { symbol: 'AAPL' },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('AAPL is $200.')));

    executeToolCallMock.mockResolvedValueOnce({ result: { price: 200 }, success: true });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'price of AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });

    expect(result.finalText).toBe('AAPL is $200.');
    expect(result.finalText).not.toContain('Let me check');
  });
});

describe('runKeishaAgent — safe tools', () => {
  it('calls executeToolCall for safe tools and feeds results back', async () => {
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'lookup_price',
        toolId: 't1',
        toolInput: { symbol: 'AAPL' },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('Done.')));

    executeToolCallMock.mockResolvedValueOnce({ result: { price: 200 }, success: true });

    const onToolResult = vi.fn();
    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      onToolResult,
    });

    expect(executeToolCallMock).toHaveBeenCalledWith('lookup_price', { symbol: 'AAPL' });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('lookup_price');
    expect(result.actions[0].success).toBe(true);
    expect(onToolResult).toHaveBeenCalledTimes(1);
  });
});

describe('runKeishaAgent — dangerous tools (security)', () => {
  it('NEVER calls executeToolCall for place_order', async () => {
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'place_order',
        toolId: 'p1',
        toolInput: { symbol: 'AAPL', side: 'buy', qty: 10 },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('Awaiting your confirmation.')));

    const createPending = vi.fn().mockResolvedValue({ id: 'pending-123', expiresAt: '2026-01-01T00:05:00Z' });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'buy AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      createPendingConfirmation: createPending,
    });

    expect(executeToolCallMock).not.toHaveBeenCalled();
    expect(createPending).toHaveBeenCalledWith({
      type: 'place_order',
      params: { symbol: 'AAPL', side: 'buy', qty: 10 },
    });
    expect(result.pendingConfirmations).toHaveLength(1);
    expect(result.pendingConfirmations[0]).toMatchObject({
      type: 'place_order',
      id: 'pending-123',
      expiresAt: '2026-01-01T00:05:00Z',
    });
  });

  it('still surfaces a pending confirmation when createPendingConfirmation is omitted (UI will reject)', async () => {
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'place_order',
        toolId: 'p1',
        toolInput: { symbol: 'AAPL', side: 'buy', qty: 10 },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('Awaiting confirmation.')));

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'buy AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });

    expect(executeToolCallMock).not.toHaveBeenCalled();
    expect(result.pendingConfirmations).toHaveLength(1);
    expect(result.pendingConfirmations[0].id).toBeUndefined(); // UI will refuse to confirm without an id
  });

  it('handles createPendingConfirmation rejection without crashing the loop', async () => {
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'place_order',
        toolId: 'p1',
        toolInput: { symbol: 'AAPL', side: 'buy', qty: 10 },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('Awaiting confirmation.')));

    const createPending = vi.fn().mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'buy AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      createPendingConfirmation: createPending,
    });

    expect(result.pendingConfirmations).toHaveLength(1);
    expect(result.pendingConfirmations[0].id).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('runKeishaAgent — iteration cap', () => {
  it('stops at MAX_TOOL_ITERATIONS (6) when Claude keeps calling tools', async () => {
    // Always return tool_use; agent should still bail out at the cap
    for (let i = 0; i < 8; i++) {
      streamMock.mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'lookup_price',
        toolId: `t${i}`,
        toolInput: { symbol: 'AAPL' },
      })));
    }
    executeToolCallMock.mockResolvedValue({ result: { price: 200 }, success: true });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'loop forever' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });

    expect(streamMock).toHaveBeenCalledTimes(6);
    expect(result.usage.iterations).toBe(6);
  });
});

describe('runKeishaAgent — token budget', () => {
  it('aborts the loop when cumulative tokens exceed maxTotalTokens', async () => {
    // Each iteration "spends" 600 tokens (500 input + 100 output). Cap at
    // 1000 tokens — should stop after 2 iterations.
    for (let i = 0; i < 6; i++) {
      streamMock.mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'lookup_price',
        toolId: `t${i}`,
        toolInput: { symbol: 'AAPL' },
        inputTokens: 500,
        outputTokens: 100,
      })));
    }
    executeToolCallMock.mockResolvedValue({ result: { price: 200 }, success: true });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'expensive' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      maxTotalTokens: 1000,
    });

    expect(result.usage.budgetExceeded).toBe(true);
    expect(result.usage.iterations).toBeLessThanOrEqual(3);
    expect(streamMock).toHaveBeenCalledTimes(result.usage.iterations);
  });

  it('does not flag budgetExceeded when usage stays under cap', async () => {
    streamMock.mockReturnValueOnce(makeStream(textOnlyTurn('cheap reply', { inputTokens: 100, outputTokens: 50 })));

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      maxTotalTokens: 5000,
    });

    expect(result.usage.budgetExceeded).toBe(false);
    expect(result.usage.iterations).toBe(1);
  });

  it('uses the default budget when none is supplied', async () => {
    expect(DEFAULT_KEISHA_TOKEN_BUDGET).toBe(120_000);
  });
});

describe('runKeishaAgent — synthesis after tool_use', () => {
  it('continues the loop after tool_use to let Claude synthesize the final answer', async () => {
    // Iteration 1: tool_use only (no text). Iteration 2: synthesis text.
    streamMock
      .mockReturnValueOnce(makeStream(toolUseTurn({
        toolName: 'lookup_price',
        toolId: 't1',
        toolInput: { symbol: 'AAPL' },
      })))
      .mockReturnValueOnce(makeStream(textOnlyTurn('AAPL is at $200, here is what that means...')));

    executeToolCallMock.mockResolvedValueOnce({ result: { price: 200 }, success: true });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'AAPL' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(result.finalText).toContain('AAPL is at $200');
  });
});

describe('runKeishaAgent — streaming hooks', () => {
  it('forwards text deltas through onTextDelta', async () => {
    streamMock.mockReturnValueOnce(makeStream(textOnlyTurn('hello world')));
    const onTextDelta = vi.fn();

    await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      onTextDelta,
    });

    expect(onTextDelta).toHaveBeenCalledWith('hello world');
  });

  it('fires onToolStart only when there are tool calls', async () => {
    streamMock.mockReturnValueOnce(makeStream(textOnlyTurn('no tools needed')));
    const onToolStart = vi.fn();

    await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      onToolStart,
    });

    expect(onToolStart).not.toHaveBeenCalled();
  });
});

describe('runKeishaAgent — thinking models', () => {
  const THINKING = { type: 'thinking', thinking: '', signature: 'sig-abc' };

  it('sends thinking blocks back unchanged with the tool results', async () => {
    const turn = toolUseTurn({ toolName: 'lookup_price', toolId: 't1', toolInput: { symbol: 'AAPL' } });
    // Thinking leads the turn, ahead of the tool call.
    turn.splice(1, 0, ...wholeBlock(0, THINKING));
    streamMock
      .mockReturnValueOnce(makeStream(turn))
      .mockReturnValueOnce(makeStream(textOnlyTurn('AAPL is $200.')));
    executeToolCallMock.mockResolvedValueOnce({ result: { price: 200 }, success: true });

    await runKeishaAgent({
      messages: [{ role: 'user', content: 'price of AAPL' }],
      system: [{ type: 'text', text: 'sys' }],
    });

    const secondCall = streamMock.mock.calls[1][0];
    const assistantTurn = secondCall.messages[1];
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content[0]).toEqual(THINKING);
    expect(assistantTurn.content.map((b: any) => b.type)).toEqual(['thinking', 'tool_use']);
  });

  it('reads the reply from the text block, not content[0]', async () => {
    const turn = textOnlyTurn('Hello Wes.');
    turn.splice(1, 0, ...wholeBlock(0, THINKING));
    streamMock.mockReturnValueOnce(makeStream(turn));

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys' }],
    });

    expect(result.finalText).toBe('Hello Wes.');
  });
});

describe('runKeishaAgent — stop reasons that must not run tools', () => {
  function withStopReason(events: StreamEvent[], stop_reason: string): StreamEvent[] {
    return events.map(e => (e.type === 'message_delta' ? { ...e, delta: { stop_reason } } : e));
  }

  it('does not execute a tool call from a turn cut off by max_tokens', async () => {
    streamMock.mockReturnValueOnce(makeStream(withStopReason(
      toolUseTurn({ toolName: 'place_order', toolId: 'p1', toolInput: { symbol: 'AAPL' } }),
      'max_tokens',
    )));
    const createPending = vi.fn();

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'buy AAPL' }],
      system: [{ type: 'text', text: 'sys' }],
      createPendingConfirmation: createPending,
    });

    expect(executeToolCallMock).not.toHaveBeenCalled();
    expect(createPending).not.toHaveBeenCalled();
    expect(result.pendingConfirmations).toHaveLength(0);
    expect(result.finalText).not.toBe('');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('returns a plain reply and runs nothing when the request is refused', async () => {
    streamMock.mockReturnValueOnce(makeStream([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]));
    const onTextDelta = vi.fn();

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys' }],
      onTextDelta,
    });

    expect(result.finalText).toMatch(/can't help/);
    expect(onTextDelta).toHaveBeenCalledWith(result.finalText);
    expect(executeToolCallMock).not.toHaveBeenCalled();
  });

  it('drops the declined model\'s tool call when a fallback model took over mid-turn', async () => {
    const events: StreamEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      ...wholeBlock(0, { type: 'thinking', thinking: '', signature: 'sig-1' }),
      ...wholeBlock(1, { type: 'tool_use', id: 'declined', name: 'place_order', input: { symbol: 'AAPL' } }),
      ...wholeBlock(2, { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }),
      ...wholeBlock(3, { type: 'tool_use', id: 'served', name: 'lookup_price', input: { symbol: 'AAPL' } }),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 50 } },
      { type: 'message_stop' },
    ];
    streamMock
      .mockReturnValueOnce(makeStream(events))
      .mockReturnValueOnce(makeStream(textOnlyTurn('Done.')));
    executeToolCallMock.mockResolvedValueOnce({ result: { price: 200 }, success: true });

    const result = await runKeishaAgent({
      messages: [{ role: 'user', content: 'AAPL' }],
      system: [{ type: 'text', text: 'sys' }],
    });

    expect(result.pendingConfirmations).toHaveLength(0);
    expect(executeToolCallMock).toHaveBeenCalledTimes(1);
    expect(executeToolCallMock).toHaveBeenCalledWith('lookup_price', { symbol: 'AAPL' });
    const echoed = streamMock.mock.calls[1][0].messages[1].content;
    expect(echoed.map((b: any) => b.id ?? b.type)).toEqual(['served']);
  });
});
