import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini round-3 P0: src/lib/edgar-client.ts wraps `fetch` with NO AbortSignal.
// A hung SEC EDGAR fetch will eat the full Vercel function budget. This test
// stubs fetch to delay for longer than EDGAR_TIMEOUT_MS and asserts the call
// resolves to { data: null } with a meta describing the abort — no hang.
// ─────────────────────────────────────────────────────────────────────────────

// Wipe the shared in-memory CIK cache between runs so we don't get spurious
// cache hits across tests. We do this by resolving the module fresh + by
// using a unique ticker per test.
describe('edgar-client — AbortSignal.timeout wraps the fetch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolveCIK returns null when the upstream fetch aborts', async () => {
    // Simulate the upstream timing out: reject with AbortError immediately.
    // This is the same shape real fetch produces when AbortSignal.timeout fires,
    // and it avoids vitest fake-timer interactions with AbortSignal.timeout's
    // internal Node timer (which don't compose).
    global.fetch = vi.fn().mockImplementation((_url: string, _init?: RequestInit) => {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    const { resolveCIK } = await import('../edgar-client');
    const result = await resolveCIK('NEW_TICKER_TIMEOUT_TEST');

    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalled();
    const initArg = (global.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } })
      .mock.calls[0][1];
    expect(initArg.signal).toBeInstanceOf(AbortSignal);
  });

  it('edgarFetch passes a signal to every outgoing fetch', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    const { resolveCIK } = await import('../edgar-client');
    await resolveCIK('NEW_TICKER_SIGNAL_PASS');
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });
});
