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
    messages: {
      stream: (...args: unknown[]) => streamMock(...args),
    },
  },
  CLAUDE_MODEL_PRIMARY: 'mock-model',
  KEISHA_SYSTEM_PROMPT: 'mock-system',
  NON_STREAM_TIMEOUT_MS: 30_000,
  STREAM_TIMEOUT_MS: 120_000,
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

function makeStream(events: StreamEvent[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
  };
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
    expect(DEFAULT_KEISHA_TOKEN_BUDGET).toBe(50_000);
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
