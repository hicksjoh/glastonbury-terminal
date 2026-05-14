import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini round-3 P0: every anthropic.messages.create()/.stream() must pass
// an AbortSignal so a slow/hung upstream call doesn't eat the full Vercel 60s
// timeout AND bill for the full generation.
//
// We stub @anthropic-ai/sdk and assert the call sites in src/lib/claude.ts
// and src/lib/keisha/agent.ts pass `{ signal }` whose value is an AbortSignal.
// ─────────────────────────────────────────────────────────────────────────────

const createCalls: Array<Record<string, unknown>> = [];
const streamCalls: Array<Record<string, unknown>> = [];

const streamMock = {
  // Make the stream async-iterable so the agent's `for await (const event of stream)`
  // loop terminates immediately with no events.
  [Symbol.asyncIterator]() {
    return {
      next: () => Promise.resolve({ done: true, value: undefined }),
    };
  },
};

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        // SDK shape: create(params, options) — signal lives in options.
        // We flatten both into one captured record so test assertions can
        // read `.signal` without caring which arg position it landed in.
        create: vi.fn().mockImplementation(
          async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
            createCalls.push({ ...params, ...(options ?? {}) });
            return {
              id: 'msg_1',
              content: [{ type: 'text', text: 'ok' }],
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        ),
        stream: vi.fn().mockImplementation(
          (params: Record<string, unknown>, options?: Record<string, unknown>) => {
            streamCalls.push({ ...params, ...(options ?? {}) });
            return streamMock;
          },
        ),
      };
    },
  };
});

// Stub anthropic-cost (it just logs)
vi.mock('@/lib/anthropic-cost', () => ({
  tagAnthropicCall: vi.fn(),
}));

// Make sure prompts module loads without crashing (it's imported by claude.ts).
vi.mock('@/lib/prompts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prompts')>('@/lib/prompts');
  return actual;
});

beforeEach(() => {
  createCalls.length = 0;
  streamCalls.length = 0;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('claude.ts — AbortSignal on every Anthropic call', () => {
  it('createMessageWithFallback passes a signal on the primary call', async () => {
    const { createMessageWithFallback } = await import('../claude');
    await createMessageWithFallback({
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(createCalls.length).toBeGreaterThan(0);
    expect(createCalls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('streamMessageWithFallback passes a signal on the primary call', async () => {
    const { streamMessageWithFallback } = await import('../claude');
    await streamMessageWithFallback({
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(streamCalls.length).toBeGreaterThan(0);
    expect(streamCalls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('generateBriefing passes a signal to anthropic.messages.create', async () => {
    const { generateBriefing } = await import('../claude');
    await generateBriefing('test portfolio');
    expect(createCalls.length).toBeGreaterThan(0);
    expect(createCalls[createCalls.length - 1].signal).toBeInstanceOf(AbortSignal);
  });

  it('generateAnalysis passes a signal to anthropic.messages.create', async () => {
    const { generateAnalysis } = await import('../claude');
    await generateAnalysis('Q', 'ctx', []);
    expect(createCalls.length).toBeGreaterThan(0);
    expect(createCalls[createCalls.length - 1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('keisha/agent.ts — AbortSignal on anthropic.messages.stream', () => {
  // Minimal stub for downstream deps so we can import the agent without
  // pulling in supabase / tool runtime.
  beforeEach(() => {
    vi.doMock('@/lib/keisha-tools', () => ({
      KEISHA_TOOLS: [],
      DANGEROUS_TOOLS: new Set<string>(),
      MAX_TOOL_ITERATIONS: 1,
      executeToolCall: vi.fn(),
      buildRenderCard: vi.fn(),
    }));
  });

  it('runKeishaAgent passes a signal to anthropic.messages.stream', async () => {
    const { runKeishaAgent } = await import('../keisha/agent');
    await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys' }] as unknown as Parameters<typeof runKeishaAgent>[0]['system'],
    });
    expect(streamCalls.length).toBeGreaterThan(0);
    expect(streamCalls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('runKeishaAgent forwards a caller-supplied AbortSignal', async () => {
    const { runKeishaAgent } = await import('../keisha/agent');
    const controller = new AbortController();
    await runKeishaAgent({
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'sys' }] as unknown as Parameters<typeof runKeishaAgent>[0]['system'],
      signal: controller.signal,
    } as Parameters<typeof runKeishaAgent>[0]);
    expect(streamCalls[streamCalls.length - 1].signal).toBe(controller.signal);
  });
});
