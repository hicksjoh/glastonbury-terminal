import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pingHealthcheck } from '../healthchecks';

describe('pingHealthcheck', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.HEALTHCHECKS_PING_KEY;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.HEALTHCHECKS_PING_KEY;
    } else {
      process.env.HEALTHCHECKS_PING_KEY = originalEnv;
    }
  });

  it('skips silently when HEALTHCHECKS_PING_KEY is not set', async () => {
    delete process.env.HEALTHCHECKS_PING_KEY;
    await pingHealthcheck('briefing-scheduled');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pings success URL with create=1 by default', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    await pingHealthcheck('briefing-scheduled');
    expect(global.fetch).toHaveBeenCalledOnce();
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('https://hc-ping.com/test-key-abc/briefing-scheduled?create=1');
  });

  it('pings /fail endpoint with status=fail', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    await pingHealthcheck('cron-tax-harvest', 'fail');
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('https://hc-ping.com/test-key-abc/cron-tax-harvest/fail?create=1');
  });

  it('pings /start endpoint with status=start', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    await pingHealthcheck('cron-storm-watch', 'start');
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe('https://hc-ping.com/test-key-abc/cron-storm-watch/start?create=1');
  });

  it('never throws even if fetch rejects (fire-and-forget)', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    global.fetch = vi.fn().mockRejectedValue(new Error('network dead'));
    await expect(pingHealthcheck('briefing-scheduled')).resolves.toBeUndefined();
  });

  it('never throws even if response is 5xx', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    global.fetch = vi.fn().mockResolvedValue(new Response('oops', { status: 503 }));
    await expect(pingHealthcheck('briefing-scheduled')).resolves.toBeUndefined();
  });

  it('uses an AbortSignal with a timeout', async () => {
    process.env.HEALTHCHECKS_PING_KEY = 'test-key-abc';
    await pingHealthcheck('briefing-scheduled');
    const opts = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
