import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * D7 (2026-08 digest QA): `20260507_email_send_log.sql` and the
 * RESEND_ALLOWED_TO_DOMAINS / RESEND_DAILY_BUDGET env vars shipped, but
 * resend-client.ts implemented neither the gates nor the log. These tests
 * pin the behaviour that closes that gap — in particular that neither gate
 * can silently swallow a digest when Supabase is unreachable.
 */

const inserted: unknown[] = [];
let countResult: { count: number | null; error: { message: string } | null } = {
  count: 0,
  error: null,
};

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (rows: unknown) => {
        inserted.push(rows);
        return Promise.resolve({ error: null });
      },
      select: () => ({
        gte: () => Promise.resolve(countResult),
      }),
    }),
  }),
}));

// vi.mock is hoisted above imports, so the static import already sees the mock.
import { sendResendEmail } from '../resend-client';

const ENV_KEYS = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_TO_EMAIL',
  'RESEND_ALLOWED_TO_DOMAINS',
  'RESEND_DAILY_BUDGET',
] as const;

describe('sendResendEmail', () => {
  const saved: Record<string, string | undefined> = {};
  const originalFetch = global.fetch;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    inserted.length = 0;
    countResult = { count: 0, error: null };
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM_EMAIL = 'keisha@terminal.johnwesleyhicks.com';
    process.env.RESEND_TO_EMAIL = 'hicksjoh@gmail.com';
    process.env.RESEND_ALLOWED_TO_DOMAINS = 'gmail.com,johnwesleyhicks.com';
    delete process.env.RESEND_DAILY_BUDGET;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-abc' }), { status: 200 }),
    );
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    global.fetch = originalFetch;
  });

  it('sends to an allowlisted recipient and logs the outcome', async () => {
    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('resend-abc');
    expect(res.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledOnce();

    const rows = inserted.flat() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to_addr: 'hicksjoh@gmail.com',
      outcome: 'sent',
      resend_id: 'resend-abc',
    });
  });

  it('rejects a recipient outside the allowlist without calling Resend', async () => {
    const res = await sendResendEmail({
      subject: 'Exfil',
      text: 'body',
      to: 'attacker@evil.example',
    });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('rejected_allowlist');
    expect(global.fetch).not.toHaveBeenCalled();

    const rows = inserted.flat() as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ outcome: 'rejected_allowlist' });
  });

  it('falls back to the RESEND_TO_EMAIL domain when no allowlist is configured', async () => {
    delete process.env.RESEND_ALLOWED_TO_DOMAINS;
    const blocked = await sendResendEmail({ subject: 's', text: 't', to: 'x@evil.example' });
    expect(blocked.outcome).toBe('rejected_allowlist');

    const allowed = await sendResendEmail({ subject: 's', text: 't', to: 'other@gmail.com' });
    expect(allowed.ok).toBe(true);
  });

  it('rejects once the daily budget is exhausted', async () => {
    process.env.RESEND_DAILY_BUDGET = '3';
    countResult = { count: 3, error: null };

    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('rejected_budget');
    expect(res.error).toContain('3/3');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still sends when the budget count is under the limit', async () => {
    process.env.RESEND_DAILY_BUDGET = '3';
    countResult = { count: 2, error: null };
    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(true);
  });

  it('fails OPEN on a budget-count error so a DB blip cannot eat the digest', async () => {
    // This is the whole reason the budget check is not fail-closed: the
    // reported symptom was digests going missing, and a Supabase hiccup
    // must not be able to add itself to the list of causes.
    process.env.RESEND_DAILY_BUDGET = '1';
    countResult = { count: null, error: { message: 'relation does not exist' } };

    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('reports and logs a Resend API failure instead of swallowing it', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 }),
    );
    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('failed');
    expect(res.error).toBe('domain not verified');

    const rows = inserted.flat() as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ outcome: 'failed', error: 'domain not verified' });
  });

  it('no-ops without RESEND_FROM_EMAIL — the silent-drop mode env-check now surfaces', async () => {
    delete process.env.RESEND_FROM_EMAIL;
    const res = await sendResendEmail({ subject: 'Weekly Report', text: 'body' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('RESEND not configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
