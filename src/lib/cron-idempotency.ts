// Cron-run idempotency.
//
// Wraps the 20260506_cron_run_idempotency.sql migration. Crons call
// `tryClaimCronRun(jobName, runKey)` before doing any side-effect work; if
// it returns false they short-circuit. On success they call
// `markCronRunComplete(jobName, runKey)` so the next scheduled run starts
// fresh without waiting for the stale window.
//
// Run-key helpers:
//   - todayKeyET()    — 'YYYY-MM-DD' for "today in America/New_York". Use
//                       for daily crons (briefing, morning-push).
//   - thisWeekKeyET() — 'YYYY-MM-DD' for the most recent Sunday in ET.
//                       Use for the Sunday weekly-report so a Monday
//                       retry of Sunday's job still maps to Sunday's key.

import { createServiceClient } from '@/lib/supabase';

/** YYYY-MM-DD for "today" in America/New_York. */
export function todayKeyET(): string {
  // 'en-CA' formats as YYYY-MM-DD. Stable across Node versions and locales.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** YYYY-MM-DD for the most recent Sunday in America/New_York. */
export function thisWeekKeyET(): string {
  // Realize the wall-clock ET date as a Date object via toLocaleString round-trip.
  // (Date math then operates in ET-local terms, which is what we want.)
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = etNow.getDay(); // 0 = Sunday
  etNow.setDate(etNow.getDate() - dayOfWeek);
  const y = etNow.getFullYear();
  const m = String(etNow.getMonth() + 1).padStart(2, '0');
  const d = String(etNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface CronClaimOptions {
  /** Default 600s. After this much time, an unfinished claim is reclaimable. */
  staleAfterSeconds?: number;
}

/**
 * Attempt to claim the run slot for (jobName, runKey).
 * Returns true exactly once per slot within the stale window.
 *
 * Fail-open: if the underlying RPC errors (Supabase down, table missing
 * mid-deploy), returns true so the cron still fires. Better to risk a
 * duplicate than to silently miss the run; the error is logged for review.
 */
export async function tryClaimCronRun(
  jobName: string,
  runKey: string,
  opts: CronClaimOptions = {},
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('try_claim_cron_run', {
    p_job_name: jobName,
    p_run_key: runKey,
    p_stale_after_seconds: opts.staleAfterSeconds ?? 600,
  });
  if (error) {
    console.error(
      `[cron-idempotency] try_claim_cron_run failed for ${jobName}/${runKey}; failing OPEN:`,
      error.message,
    );
    return true;
  }
  return data === true;
}

/**
 * Mark a (jobName, runKey) slot as completed so future invocations skip
 * immediately. Best-effort — failure to mark is non-fatal because the
 * stale window will eventually free the slot anyway.
 */
export async function markCronRunComplete(
  jobName: string,
  runKey: string,
  result?: Record<string, unknown>,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc('mark_cron_run_complete', {
    p_job_name: jobName,
    p_run_key: runKey,
    p_result: result ?? null,
  });
  if (error) {
    console.error(
      `[cron-idempotency] mark_cron_run_complete failed for ${jobName}/${runKey}:`,
      error.message,
    );
  }
}
