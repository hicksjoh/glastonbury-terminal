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
import { log } from '@/lib/logger';

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
  outcome:
    | 'sent'
    | 'failed'
    | 'rejected_allowlist'
    | 'rejected_budget'
    | 'rejected_no_recipient';
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
  } catch (err) {
    // Codex round-4: previously a bare catch swallowed the failure silently,
    // which let DB outages mask runaway budgets and made auditing impossible.
    // Still don't block the send (audit must be best-effort), but at minimum
    // surface the failure to pino so it lands in our log pipeline.
    log.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        outcome: row.outcome,
        to_addr: row.to_addr,
      },
      'resend audit-log insert failed — outcome not persisted',
    );
  }
}

/**
 * Returns today's email send count, or `null` when the table cannot be read.
 * Callers MUST treat `null` as "can't verify" and fail closed — otherwise a
 * misconfigured DB silently lifts the daily budget.
 */
async function countTodaySends(): Promise<number | null> {
  try {
    const sb = createServiceClient();
    const since = startOfTodayUtcIso();
    const res = await sb
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', since);
    const count = (res as unknown as { count?: number | null }).count ?? 0;
    return typeof count === 'number' && count >= 0 ? count : null;
  } catch (err) {
    // Codex round-4: previously this returned 0 on error, which silently
    // lifted the daily budget when the DB was unreachable. Now we return
    // null so the caller fails closed.
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'resend budget read failed — failing closed on send',
    );
    return null;
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
    // Codex round-4: previously returned without writing email_send_log,
    // which made budget enforcement leaky (these attempts didn't count
    // toward the daily cap, so a misconfigured caller could hammer the
    // endpoint forever). Log it.
    await logSend({
      to_addr: '<no-recipient>',
      subject: args.subject,
      outcome: 'rejected_no_recipient',
      error,
    });
    return { ok: false, error, errorCode: 'no_recipient' };
  }

  const offenders = allRecipients.filter((addr) => !allowlist.includes(addr));
  if (offenders.length > 0) {
    const error = `Refusing to send: recipient(s) not on allowlist: ${offenders.join(', ')}`;
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'rejected_allowlist', error });
    return { ok: false, error, errorCode: 'rejected_allowlist' };
  }

  // 2. Budget enforcement — count of TODAY's email_send_log rows.
  // Codex round-4: countTodaySends() now returns null when the DB read
  // fails, which we treat as "can't verify" and fail closed. Previously
  // a DB outage silently returned 0 and lifted the budget entirely.
  const budget = readDailyBudget();
  const todayCount = await countTodaySends();
  if (todayCount === null) {
    const error = 'Refusing to send: cannot verify daily send budget (DB unreachable)';
    await logSend({ to_addr: primaryAddr, subject: args.subject, outcome: 'rejected_budget', error });
    return { ok: false, error, errorCode: 'rejected_budget' };
  }
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
