import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Codex p6-7 round-3: src/lib/resend-client.ts must enforce allowlist + daily
// budget, write to email_send_log, and fail closed when env is missing. The
// helper was previously a sham: it would send to any caller-supplied `to`
// directly to Resend without checking either.
//
// Tests use a `getSupabaseAdmin`-style mock; `sendResendEmail` reads the
// service-role client via `createServiceClient` from '@/lib/supabase'.
// ─────────────────────────────────────────────────────────────────────────────

type MockRow = { to_addr: string; outcome: string; subject: string; resend_id?: string | null; error?: string | null };

const supabaseRows: MockRow[] = [];

// Mock the supabase service-role client. We want to be able to:
//   • track every insert (for the audit log assertion)
//   • return a configurable count from email_send_log (for the budget assertion)
let mockCountToday = 0;

vi.mock('@/lib/supabase', () => {
  return {
    createServiceClient: () => ({
      from: (table: string) => {
        if (table !== 'email_send_log') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          insert: (row: MockRow | MockRow[]) => {
            const rows = Array.isArray(row) ? row : [row];
            supabaseRows.push(...rows);
            return Promise.resolve({ error: null });
          },
          select: () => ({
            gte: () => Promise.resolve({ count: mockCountToday, data: null, error: null }),
          }),
        };
      },
    }),
  };
});

import { sendResendEmail } from '../resend-client';

const RESEND_OK = { id: 'resend_test_abc123' };

describe('sendResendEmail — allowlist enforcement', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    supabaseRows.length = 0;
    mockCountToday = 0;
    process.env.RESEND_API_KEY = 'rs_test';
    process.env.RESEND_FROM_EMAIL = 'keisha@terminal.example.com';
    process.env.RESEND_TO_EMAIL = 'allowed@example.com';
    process.env.RESEND_ALLOWED_RECIPIENTS = 'allowed@example.com,owner@example.com';
    process.env.RESEND_DAILY_BUDGET = '50';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(RESEND_OK), { status: 200 }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('sends when recipient is on the allowlist', async () => {
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(supabaseRows[0].outcome).toBe('sent');
  });

  it('rejects when recipient is NOT on the allowlist', async () => {
    const res = await sendResendEmail({
      to: 'attacker@evil.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/allowlist/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(supabaseRows[0].outcome).toBe('rejected_allowlist');
  });

  it('rejects when ANY recipient in a list is not on the allowlist', async () => {
    const res = await sendResendEmail({
      to: ['allowed@example.com', 'attacker@evil.com'],
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/allowlist/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(supabaseRows[0].outcome).toBe('rejected_allowlist');
  });

  it('fails closed when RESEND_ALLOWED_RECIPIENTS is unset', async () => {
    delete process.env.RESEND_ALLOWED_RECIPIENTS;
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/RESEND_ALLOWED_RECIPIENTS not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('sendResendEmail — daily budget enforcement', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    supabaseRows.length = 0;
    mockCountToday = 0;
    process.env.RESEND_API_KEY = 'rs_test';
    process.env.RESEND_FROM_EMAIL = 'keisha@terminal.example.com';
    process.env.RESEND_TO_EMAIL = 'allowed@example.com';
    process.env.RESEND_ALLOWED_RECIPIENTS = 'allowed@example.com';
    process.env.RESEND_DAILY_BUDGET = '50';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(RESEND_OK), { status: 200 }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('rejects when today count is at the budget', async () => {
    mockCountToday = 50;
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/budget/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(supabaseRows[0].outcome).toBe('rejected_budget');
  });

  it('rejects when today count is over the budget', async () => {
    mockCountToday = 99;
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/budget/i);
    expect(supabaseRows[0].outcome).toBe('rejected_budget');
  });

  it('sends when today count is under the budget', async () => {
    mockCountToday = 49;
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(true);
    expect(supabaseRows[0].outcome).toBe('sent');
  });

  it('defaults RESEND_DAILY_BUDGET to 50 when unset', async () => {
    delete process.env.RESEND_DAILY_BUDGET;
    mockCountToday = 50;
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'hi',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/budget/i);
  });
});

describe('sendResendEmail — audit log row written', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    supabaseRows.length = 0;
    mockCountToday = 0;
    process.env.RESEND_API_KEY = 'rs_test';
    process.env.RESEND_FROM_EMAIL = 'keisha@terminal.example.com';
    process.env.RESEND_TO_EMAIL = 'allowed@example.com';
    process.env.RESEND_ALLOWED_RECIPIENTS = 'allowed@example.com';
    process.env.RESEND_DAILY_BUDGET = '50';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('writes a row with outcome=sent + resend_id on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'rs_abc123' }), { status: 200 }),
    );
    await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'subj',
      text: 'body',
    });
    expect(supabaseRows).toHaveLength(1);
    expect(supabaseRows[0].outcome).toBe('sent');
    expect(supabaseRows[0].resend_id).toBe('rs_abc123');
    expect(supabaseRows[0].subject).toBe('subj');
    expect(supabaseRows[0].to_addr).toBe('allowed@example.com');
  });

  it('writes outcome=failed when Resend returns non-2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Internal' }), { status: 500 }),
    );
    const res = await sendResendEmail({
      to: 'allowed@example.com',
      subject: 'subj',
      text: 'body',
    });
    expect(res.ok).toBe(false);
    expect(supabaseRows).toHaveLength(1);
    expect(supabaseRows[0].outcome).toBe('failed');
  });
});
