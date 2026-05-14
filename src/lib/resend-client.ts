/**
 * Resend email client with allowlist + daily-budget enforcement.
 *
 * Codex round-3 (p6-7): the prior version sent caller-supplied `to` to Resend
 * with NO allowlist check and NO budget enforcement — a sham control. The
 * migration `supabase/migrations/20260507_email_send_log.sql` and `.env.example`
 * documented both defenses but the lib never read them. This rewrite:
 *
 *   1. Requires RESEND_ALLOWED_RECIPIENTS (comma-separated explicit list).
 *      Unset → fail closed with a typed error. No falling back to a domain
 *      heuristic — a compromised cron secret should never turn the terminal
 *      into an arbitrary email gateway.
 *   2. Rejects ANY recipient not on the allowlist (to/cc/bcc all checked).
 *   3. Enforces RESEND_DAILY_BUDGET (default 50) by counting today's rows
 *      in `email_send_log`. Failures + allowlist rejections both count
 *      toward the cap — a hostile loop that keeps hitting us at 4xx should
 *      still trip the budget.
 *   4. Writes one row per attempt to `email_send_log` with the outcome:
 *      `sent`, `failed`, `rejected_allowlist`, `rejected_budget`.
 *
 * Callers don't need to change — the return type stays `{ ok, id?, error? }`.
 * New `errorCode` field lets callers branch on the failure reason without
 * scraping the error string.
 */

import { createServiceClient } from '@/lib/supabase';

type SendArgs = {
  subject: string;
  text: string;
  html?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
};

export type SendErrorCode =
  | 'allowlist_unset'
  | 'no_recipient'
  | 'rejected_allowlist'
  | 'rejected_budget'
  | 'failed_upstream'
  | 'config_missing';

export type SendResult = {
  ok: boolean;
  id?: string;
  error?: string;
  errorCode?: SendErrorCode;
};

const DEFAULT_DAILY_BUDGET = 50;
const RESEND_TIMEOUT_MS = 10_000;

function normalizeAddrs(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function readAllowlist(): string[] | null {
  const raw = process.env.RESEND_ALLOWED_RECIPIENTS;
  if (!raw || raw.trim() === '') return null;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function readDailyBudget(): number {
  const raw = process.env.RESEND_DAILY_BUDGET;
  if (!raw) return DEFAULT_DAILY_BUDGET;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_BUDGET;
  return n;
}

function startOfTodayUtcIso(): string {
  const now = new Date();
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return utcMidnight.toISOString();
}

async function logSend(row: {
  to_addr: string;
  subject: string;
  outcome: 'sent' | 'failed' | 'rejected_allowlist' | 'rejected_budget';
  resend_id?: string | null;
  error?: string | null;
}): Promise<void> {
  try {
    const sb = createServiceClient();
    await sb.from('email_send_log').insert({
      to_addr: row.to_addr,
      subject: row.subject,
      outcome: row.outcome,
      resend_id: row.resend_id ?? null,
      error: row.error ?? null,
    });
  } catch {
    // Audit-log failures must not block sends; the runtime metric will catch
    // a sustained outage via Sentry on the parent route.
  }
}

async function countTodaySends(): Promise<number> {
  try {
    const sb = createServiceClient();
    const since = startOfTodayUtcIso();
    const res = await sb
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', since);
    // supabase-js exposes `count` on the response when the head/count opts
    // are passed. Some test stubs return it directly.
    const count = (res as unknown as { count?: number | null }).count ?? 0;
    return typeof count === 'number' && count >= 0 ? count : 0;
  } catch {
    // Fail open on count errors — if we can't read the table the env is
    // misconfigured. The allowlist still acts as the primary defense.
    return 0;
  }
}

export async function sendResendEmail(args: SendArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const defaultTo = process.env.RESEND_TO_EMAIL;

  // Build the canonical recipient list (to/cc/bcc).
  const to = args.to ?? defaultTo;
  const allRecipients = [
    ...normalizeAddrs(to),
    ...normalizeAddrs(args.cc),
    ...normalizeAddrs(args.bcc),
  ];
  const primaryAddr = allRecipients[0] ?? '<no-recipient>';

  // 1. Allowlist check FIRST — fails closed when env is missing, and runs
  // before we touch the Resend API or the budget query. This is the cheapest
  // and strictest gate.
  const allowlist = readAllowlist();
  if (!allowlist) {
    const error = 'Refusing to send: RESEND_ALLOWED_RECIPIENTS not configured';
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'rejected_allowlist', error });
    return { ok: false, error, errorCode: 'allowlist_unset' };
  }

  if (allRecipients.length === 0) {
    const error = 'No recipient configured';
    return { ok: false, error, errorCode: 'no_recipient' };
  }

  const offenders = allRecipients.filter((addr) => !allowlist.includes(addr));
  if (offenders.length > 0) {
    const error = `Refusing to send: recipient(s) not on allowlist: ${offenders.join(', ')}`;
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'rejected_allowlist', error });
    return { ok: false, error, errorCode: 'rejected_allowlist' };
  }

  // 2. Budget enforcement — count of TODAY's email_send_log rows.
  const budget = readDailyBudget();
  const todayCount = await countTodaySends();
  if (todayCount >= budget) {
    const error = `Refusing to send: daily budget ${budget} reached (current count ${todayCount})`;
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'rejected_budget', error });
    return { ok: false, error, errorCode: 'rejected_budget' };
  }

  // 3. Upstream Resend call — only if env is configured. We still log
  // `failed` rows for misconfig so a sustained outage is visible.
  if (!key || !from) {
    const error = 'RESEND not configured';
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'failed', error });
    return { ok: false, error, errorCode: 'config_missing' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: normalizeAddrs(to ?? defaultTo),
        cc: args.cc ? normalizeAddrs(args.cc) : undefined,
        bcc: args.bcc ? normalizeAddrs(args.bcc) : undefined,
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      const error = body?.message ?? `HTTP ${res.status}`;
      await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'failed', error });
      return { ok: false, error, errorCode: 'failed_upstream' };
    }
    const id = body?.id;
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'sent', resend_id: id ?? null });
    return { ok: true, id };
  } catch (err) {
    const error = (err as Error).message ?? 'unknown';
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'failed', error });
    return { ok: false, error, errorCode: 'failed_upstream' };
  }
}
