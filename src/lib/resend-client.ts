/**
 * Minimal Resend email client. Used by research completion notifications,
 * storm alerts, tax harvester, coach reviews, the Sunday weekly report and
 * the Friday SLO roundup. Graceful no-op when RESEND_API_KEY is unset so
 * nothing breaks in dev.
 *
 * D7 (2026-08 digest QA): `20260507_email_send_log.sql` shipped the
 * `email_send_log` table and `.env.example` documented
 * RESEND_ALLOWED_TO_DOMAINS + RESEND_DAILY_BUDGET, but this lib implemented
 * none of it — the table was never written and both env vars were dead.
 *
 * That left two holes. The security one (p6-7: caller-supplied `to` with no
 * allowlist or budget turns the terminal into an open email gateway) and the
 * operational one that prompted this pass: with no send log there was no way
 * to answer "did Sunday's digest actually go out?" — the only trace of a
 * delivery was a Vercel function log that ages out.
 */

import { createServiceClient } from '@/lib/supabase';

type SendArgs = {
  subject: string;
  text: string;
  html?: string;
  to?: string | string[];
};

export type SendOutcome = 'sent' | 'failed' | 'rejected_allowlist' | 'rejected_budget';

export type SendResult = {
  ok: boolean;
  id?: string;
  error?: string;
  /** Present whenever the attempt reached the allowlist/budget gates. */
  outcome?: SendOutcome;
};

const DEFAULT_DAILY_BUDGET = 100;

/** Domains a digest may be delivered to. Falls back to RESEND_TO_EMAIL's own domain. */
function allowedDomains(): string[] {
  const configured = (process.env.RESEND_ALLOWED_TO_DOMAINS ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  const fallback = (process.env.RESEND_TO_EMAIL ?? '').split('@')[1]?.toLowerCase();
  return fallback ? [fallback] : [];
}

function domainOf(addr: string): string {
  return addr.trim().toLowerCase().split('@')[1] ?? '';
}

/**
 * The instant of the most recent midnight in America/New_York — the budget
 * resets on the ET day boundary.
 *
 * Derived by subtracting the current ET wall-clock time-of-day from `now`,
 * which is correct on both sides of a DST transition. (Composing a string
 * with a hardcoded `-05:00` would drift by an hour for eight months of the
 * year — the same class of bug as the UTC cron schedules.)
 */
function startOfTodayET(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const field = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  // 'en-US' hour12:false renders midnight as 24 in some ICU versions.
  const hours = field('hour') % 24;
  const msIntoEtDay =
    ((hours * 60 + field('minute')) * 60 + field('second')) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - msIntoEtDay);
}

/**
 * Record an attempt. Best-effort: a logging failure must never stop or fail
 * a digest, so this swallows its own errors after a console note.
 */
async function logSend(
  recipients: string[],
  subject: string,
  outcome: SendOutcome,
  extra: { resendId?: string; error?: string } = {},
): Promise<void> {
  try {
    const sb = createServiceClient();
    const { error } = await sb.from('email_send_log').insert(
      recipients.map(to_addr => ({
        to_addr,
        subject: subject.slice(0, 500),
        outcome,
        resend_id: extra.resendId ?? null,
        error: extra.error ?? null,
      })),
    );
    if (error) console.error('[resend] email_send_log insert failed:', error.message);
  } catch (err) {
    console.error('[resend] email_send_log insert threw:', (err as Error).message);
  }
}

/**
 * Attempts recorded so far today (ET), across every outcome — a rejected
 * send still counts, since a hostile loop keeps hitting Resend even when it
 * 4xx's us.
 *
 * Fails OPEN: if the count can't be read (Supabase down, migration not
 * applied) we let the send through. A DB blip must not silently swallow the
 * Sunday digest — that is the exact failure mode this QA pass was chasing.
 */
async function sendsToday(): Promise<number | null> {
  try {
    const sb = createServiceClient();
    const { count, error } = await sb
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', startOfTodayET().toISOString());
    if (error) {
      console.error('[resend] budget count failed, failing OPEN:', error.message);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.error('[resend] budget count threw, failing OPEN:', (err as Error).message);
    return null;
  }
}

export async function sendResendEmail(args: SendArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const defaultTo = process.env.RESEND_TO_EMAIL;
  if (!key || !from) return { ok: false, error: 'RESEND not configured' };

  const to = args.to ?? defaultTo;
  if (!to) return { ok: false, error: 'No recipient configured' };

  const recipients = (Array.isArray(to) ? to : [to]).map(r => r.trim()).filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: 'No recipient configured' };

  // ─── Gate 1: recipient allowlist ────────────────────────
  const allowed = allowedDomains();
  if (allowed.length > 0) {
    const blocked = recipients.filter(r => !allowed.includes(domainOf(r)));
    if (blocked.length > 0) {
      const error = `Recipient domain not allowlisted: ${blocked.map(domainOf).join(', ')}`;
      await logSend(blocked, args.subject, 'rejected_allowlist', { error });
      return { ok: false, error, outcome: 'rejected_allowlist' };
    }
  }

  // ─── Gate 2: daily send budget ──────────────────────────
  const budget = Number(process.env.RESEND_DAILY_BUDGET ?? DEFAULT_DAILY_BUDGET);
  const used = await sendsToday();
  if (used !== null && Number.isFinite(budget) && used + recipients.length > budget) {
    const error = `Daily email budget exhausted (${used}/${budget} today)`;
    await logSend(recipients, args.subject, 'rejected_budget', { error });
    return { ok: false, error, outcome: 'rejected_budget' };
  }

  // ─── Send ───────────────────────────────────────────────
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    if (!res.ok) {
      const error = body?.message ?? `HTTP ${res.status}`;
      await logSend(recipients, args.subject, 'failed', { error });
      return { ok: false, error, outcome: 'failed' };
    }
    await logSend(recipients, args.subject, 'sent', { resendId: body?.id });
    return { ok: true, id: body?.id, outcome: 'sent' };
  } catch (err) {
    const error = (err as Error).message;
    await logSend(recipients, args.subject, 'failed', { error });
    return { ok: false, error, outcome: 'failed' };
  }
}
