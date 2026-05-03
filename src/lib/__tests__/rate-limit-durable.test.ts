import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * P0-6 (hardening/p0-codex-fixes) — durable rate limiter integration test.
 *
 * The durable limiter calls a Postgres RPC (`rate_limit_hit`) that returns
 * `{ allowed, count, reset_at }` — atomic increment + window-based reset.
 * We mock the Supabase RPC and assert the helper:
 *   1. forwards the limit + window to the RPC,
 *   2. flips `allowed=false` once the RPC says so,
 *   3. degrades gracefully to the in-memory fallback if the RPC errors.
 */
describe('checkRateLimitDurable', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };
  });

  afterEach(() => {
    process.env = env;
    vi.resetModules();
  });

  it('returns allowed=true when the RPC says count <= limit', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, count: 1, reset_at: new Date().toISOString() }],
      error: null,
    });
    vi.doMock('@/lib/supabase', () => ({
      createServiceClient: () => ({ rpc }),
    }));

    const { checkRateLimitDurable } = await import('../rate-limit-durable');
    const r = await checkRateLimitDurable('endpoint-x', 'wes', 5, 60);

    expect(r.allowed).toBe(true);
    expect(r.source).toBe('durable');
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: 'endpoint-x:wes',
      p_limit: 5,
      p_window_s: 60,
    });
  });

  it('flips to allowed=false once the RPC returns allowed=false', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, count: 6, reset_at: new Date().toISOString() }],
      error: null,
    });
    vi.doMock('@/lib/supabase', () => ({
      createServiceClient: () => ({ rpc }),
    }));

    const { checkRateLimitDurable } = await import('../rate-limit-durable');
    const r = await checkRateLimitDurable('endpoint-x', 'wes', 5, 60);

    expect(r.allowed).toBe(false);
  });

  it('falls back to the in-memory limiter when Supabase errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    });
    vi.doMock('@/lib/supabase', () => ({
      createServiceClient: () => ({ rpc }),
    }));

    const { checkRateLimitDurable } = await import('../rate-limit-durable');
    // First call should be allowed (in-memory bucket fresh).
    const a = await checkRateLimitDurable('endpoint-x', 'wes', 1, 60);
    expect(a.allowed).toBe(true);
    expect(a.source).toBe('memory-fallback');

    // Second call inside the window must trip the in-memory cap.
    const b = await checkRateLimitDurable('endpoint-x', 'wes', 1, 60);
    expect(b.allowed).toBe(false);
    expect(b.source).toBe('memory-fallback');
  });
});

describe('getIpKey', () => {
  it('reads x-forwarded-for first, then x-real-ip, then unknown', async () => {
    const { getIpKey } = await import('../rate-limit-durable');

    const make = (h: Record<string, string>): { headers: { get: (k: string) => string | null } } => ({
      headers: {
        get: (k: string) => h[k.toLowerCase()] ?? null,
      },
    });

    expect(
      getIpKey(make({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }) as never),
    ).toBe('ip:203.0.113.5');
    expect(
      getIpKey(make({ 'x-real-ip': '198.51.100.7' }) as never),
    ).toBe('ip:198.51.100.7');
    expect(getIpKey(make({}) as never)).toBe('ip:unknown');
  });
});
