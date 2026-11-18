// Guards the overload fallback on streaming Claude calls.
//
// messages.stream() never throws synchronously: an overloaded primary
// model surfaces on the stream's 'error' event / as a finalMessage()
// rejection. A try/catch around the stream() call therefore never fires,
// which is how every streaming route shipped a fallback branch that was
// dead code. These tests fail the request the way the SDK really does.

import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('@sentry/nextjs', () => ({}));

import { streamWithFallback } from '../claude';

type FakeMessage = { text: string; usage: { input_tokens: number; output_tokens: number } };

// Mimics the SDK's MessageStream: creation always succeeds; deltas fire on
// the 'text' listener; a failure fires 'error' and rejects finalMessage().
function fakeStream(script: { deltas?: string[]; error?: unknown }) {
  const textListeners: Array<(delta: string) => void> = [];
  const errorListeners: Array<(err: unknown) => void> = [];
  return {
    on(event: string, cb: (arg: never) => void) {
      if (event === 'text') textListeners.push(cb as (delta: string) => void);
      if (event === 'error') errorListeners.push(cb as (err: unknown) => void);
      return this;
    },
    async finalMessage(): Promise<FakeMessage> {
      await Promise.resolve();
      let text = '';
      for (const d of script.deltas ?? []) {
        text += d;
        textListeners.forEach(cb => cb(d));
      }
      if (script.error) {
        errorListeners.forEach(cb => cb(script.error));
        throw script.error;
      }
      return { text, usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
}

function apiError(status: number | undefined, type?: string) {
  return Object.assign(new Error(`${status ?? ''} ${type ?? 'error'}`), { status, type });
}

const MODELS = ['primary-model', 'fallback-model'] as const;

describe('streamWithFallback', () => {
  it('serves from the first model when it succeeds', async () => {
    const start = vi.fn((model: string) => fakeStream({ deltas: ['hi ', model] }));
    const onText = vi.fn();

    const result = await streamWithFallback({ models: MODELS, start, onText });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.modelUsed).toBe('primary-model');
    expect(result.fellBack).toBe(false);
    expect(result.message.text).toBe('hi primary-model');
    expect(onText.mock.calls.map(c => c[0])).toEqual(['hi ', 'primary-model']);
  });

  it.each([429, 529, 503])('retries on the second model when the first rejects with %i before any text', async status => {
    const start = vi.fn((model: string) =>
      model === 'primary-model'
        ? fakeStream({ error: apiError(status) })
        : fakeStream({ deltas: ['from fallback'] }));
    const onText = vi.fn();

    const result = await streamWithFallback({ models: MODELS, start, onText });

    expect(start.mock.calls.map(c => c[0])).toEqual(['primary-model', 'fallback-model']);
    expect(result.modelUsed).toBe('fallback-model');
    expect(result.fellBack).toBe(true);
    expect(result.message.text).toBe('from fallback');
    expect(onText.mock.calls.map(c => c[0])).toEqual(['from fallback']);
  });

  it('retries on an overloaded_error delivered mid-stream (no HTTP status)', async () => {
    // After a 200, the SDK raises SSE `error` events as APIError with
    // status undefined — only the type says it was an overload.
    const start = vi.fn((model: string) =>
      model === 'primary-model'
        ? fakeStream({ error: apiError(undefined, 'overloaded_error') })
        : fakeStream({ deltas: ['ok'] }));

    const result = await streamWithFallback({ models: MODELS, start });

    expect(result.modelUsed).toBe('fallback-model');
  });

  it('does not restart once text has reached the caller — the error surfaces', async () => {
    const start = vi.fn(() => fakeStream({ deltas: ['half an ans'], error: apiError(529) }));
    const onText = vi.fn();

    await expect(streamWithFallback({ models: MODELS, start, onText })).rejects.toMatchObject({ status: 529 });

    expect(start).toHaveBeenCalledTimes(1);
    expect(onText.mock.calls.map(c => c[0])).toEqual(['half an ans']);
  });

  it('does not retry non-retryable errors', async () => {
    const start = vi.fn(() => fakeStream({ error: apiError(400) }));

    await expect(streamWithFallback({ models: MODELS, start })).rejects.toMatchObject({ status: 400 });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('surfaces the second model\'s error when both fail (one retry only)', async () => {
    const start = vi.fn((model: string) =>
      fakeStream({ error: apiError(model === 'primary-model' ? 529 : 429) }));

    await expect(streamWithFallback({ models: MODELS, start })).rejects.toMatchObject({ status: 429 });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('announces the serving model once, before its first text', async () => {
    const order: string[] = [];
    const start = (model: string) =>
      model === 'primary-model'
        ? fakeStream({ error: apiError(529) })
        : fakeStream({ deltas: ['a', 'b'] });

    await streamWithFallback({
      models: MODELS,
      start,
      onModel: m => order.push(`model:${m}`),
      onText: d => order.push(`text:${d}`),
    });

    expect(order).toEqual(['model:fallback-model', 'text:a', 'text:b']);
  });

  it('announces the serving model even when the reply has no text', async () => {
    const onModel = vi.fn();
    await streamWithFallback({ models: MODELS, start: () => fakeStream({}), onModel });
    expect(onModel.mock.calls).toEqual([['primary-model']]);
  });

  it('falls back through the real SDK stream, where a 529 is not a sync throw', async () => {
    const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const okBody = [
      sse('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fallback-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } }),
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'still here' } }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }),
      sse('message_stop', { type: 'message_stop' }),
    ].join('');

    const requested: string[] = [];
    const fetchMock = async (_url: unknown, init?: { body?: unknown }) => {
      const model = JSON.parse(String(init?.body)).model as string;
      requested.push(model);
      if (model === 'primary-model') {
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
          { status: 529, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(okBody, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const client = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: fetchMock as unknown as typeof fetch });

    const onText = vi.fn();
    const result = await streamWithFallback({
      models: MODELS,
      start: model => client.messages.stream({ model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
      onText,
    });

    expect(requested).toEqual(['primary-model', 'fallback-model']);
    expect(result.modelUsed).toBe('fallback-model');
    expect(onText.mock.calls.map(c => c[0])).toEqual(['still here']);
    expect(result.message.usage.output_tokens).toBe(2);
  });
});
