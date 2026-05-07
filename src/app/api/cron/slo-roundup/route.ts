import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { tryClaimCronRun, markCronRunComplete, thisWeekKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// p5-3: codifies the Friday-afternoon SLO roundup from
// docs/observability/slos.md as automation. Pulls operational counters
// from Supabase and emails a digest to Wes so the weekly review takes
// 5 seconds (open the email) instead of 5 minutes (run the manual check).
//
// Scope (MVP):
//   - cron_runs: 7-day per-job success counts and last-run timestamps
//   - briefings: count of briefings persisted in last 7 days
//   - journal: trade entries logged in last 7 days
//   - oauth_clients: active (non-revoked) client count
//   - cron_runs failures: any rows with claimed_at but no completed_at
//     older than the stale window (10min) — indicates a real failure
//     that didn't recover on retry
//
// Out of scope (future):
//   - Sentry totals: would require Sentry HTTP API + auth token. Doc'd
//     for Week 6.
//   - Anthropic spend: would require Logtail/drain API to aggregate the
//     log lines emitted by anthropic-cost.ts.
//
// Schedule: Fridays 5:00 PM EDT (`0 21 * * 5` UTC).
// Idempotent via cron_runs (one per ISO-week).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HC_SLUG = 'slo-roundup';
const JOB_NAME = 'slo-roundup';

interface CronJobRow {
  job_name: string;
  run_count: number;
  last_completed: string | null;
  has_stuck_run: boolean;
}

interface RoundupData {
  weekOf: string;
  cronJobs: CronJobRow[];
  briefingsThisWeek: number;
  journalEntriesThisWeek: number;
  activeOauthClients: number;
  revokedOauthClients: number;
  windowStart: string;
}

async function gather(): Promise<RoundupData> {
  const supabase = createServiceClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // Cron runs aggregation — group by job_name. We do it client-side because
  // the row count is tiny (≤ ~80 / week across 8 jobs).
  const { data: cronRows } = await supabase
    .from('cron_runs')
    .select('job_name, claimed_at, completed_at')
    .gte('claimed_at', sevenDaysAgo);

  const byJob = new Map<string, { count: number; lastCompleted: string | null; stuck: boolean }>();
  for (const row of (cronRows ?? []) as Array<{ job_name: string; claimed_at: string; completed_at: string | null }>) {
    const cur = byJob.get(row.job_name) ?? { count: 0, lastCompleted: null, stuck: false };
    if (row.completed_at) {
      cur.count++;
      if (!cur.lastCompleted || row.completed_at > cur.lastCompleted) {
        cur.lastCompleted = row.completed_at;
      }
    } else if (row.claimed_at < tenMinAgo) {
      cur.stuck = true;
    }
    byJob.set(row.job_name, cur);
  }

  const cronJobs: CronJobRow[] = Array.from(byJob.entries())
    .map(([job_name, v]) => ({
      job_name,
      run_count: v.count,
      last_completed: v.lastCompleted,
      has_stuck_run: v.stuck,
    }))
    .sort((a, b) => a.job_name.localeCompare(b.job_name));

  // Activity counters — best-effort, skip the field if a table doesn't exist.
  const briefingCount = await countSince(supabase, 'briefings', 'created_at', sevenDaysAgo);
  const journalCount = await countSince(supabase, 'trade_journal', 'created_at', sevenDaysAgo);

  // OAuth client lifecycle (p2-1 columns)
  const { count: activeClients } = await supabase
    .from('oauth_clients')
    .select('id', { count: 'exact', head: true })
    .is('revoked_at', null);
  const { count: revokedClients } = await supabase
    .from('oauth_clients')
    .select('id', { count: 'exact', head: true })
    .not('revoked_at', 'is', null);

  return {
    weekOf: thisWeekKeyET(),
    cronJobs,
    briefingsThisWeek: briefingCount,
    journalEntriesThisWeek: journalCount,
    activeOauthClients: activeClients ?? 0,
    revokedOauthClients: revokedClients ?? 0,
    windowStart: sevenDaysAgo,
  };
}

async function countSince(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string,
  iso: string,
): Promise<number> {
  try {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .gte(column, iso);
    return count ?? 0;
  } catch {
    return 0;
  }
}

function buildEmail(data: RoundupData): { subject: string; text: string; html: string } {
  const subject = `📊 SLO Roundup — week of ${data.weekOf}`;
  const lines: string[] = [];
  lines.push(`SLO Roundup — week of ${data.weekOf}`);
  lines.push(`Window: past 7 days (since ${data.windowStart.slice(0, 10)})`);
  lines.push('');

  lines.push('CRON JOBS');
  if (data.cronJobs.length === 0) {
    lines.push('  ⚠️  No cron runs recorded — check Vercel cron config + cron_runs migration');
  } else {
    for (const j of data.cronJobs) {
      const stuckMark = j.has_stuck_run ? ' 🟠 STUCK' : '';
      const last = j.last_completed ? j.last_completed.slice(0, 16).replace('T', ' ') : 'never';
      lines.push(`  ${j.job_name.padEnd(28)} ${String(j.run_count).padStart(3)} runs · last ok ${last}${stuckMark}`);
    }
  }
  lines.push('');

  lines.push('ACTIVITY');
  lines.push(`  Briefings persisted:    ${data.briefingsThisWeek}`);
  lines.push(`  Journal entries:        ${data.journalEntriesThisWeek}`);
  lines.push('');

  lines.push('OAUTH CLIENTS');
  lines.push(`  Active:                 ${data.activeOauthClients}`);
  lines.push(`  Revoked:                ${data.revokedOauthClients}`);
  lines.push('');

  lines.push('NEXT STEPS');
  lines.push(`  Check Sentry for any tier-1 SLO violations:`);
  lines.push(`    https://sentry.io/organizations/<org>/projects/glastonbury-terminal/`);
  lines.push(`  Check Healthchecks dashboard for cron status grid`);
  lines.push(`  See docs/observability/slos.md for tier definitions and budgets`);
  lines.push('');
  lines.push('— Glastonbury Terminal · automated weekly roundup');

  const text = lines.join('\n');
  const html = `<pre style="font-family: ui-monospace, monospace; line-height: 1.55; color: #e8e8e8; background: #08080d; padding: 24px;">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;

  return { subject, text, html };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/slo-roundup' });

  if (!(await cronIsAuthorized(req, { routeName: '/api/cron/slo-roundup' }))) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('mode') === 'dry-run';
  const runKey = thisWeekKeyET();

  if (!dryRun) {
    const claimed = await tryClaimCronRun(JOB_NAME, runKey);
    if (!claimed) {
      log.info({ run_key: runKey, outcome: 'skipped_idempotent' }, 'slo-roundup already ran this week');
      return NextResponse.json({ ok: true, skipped: 'already_ran_this_week', runKey });
    }
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey, dry_run: dryRun }, 'slo-roundup start');

  try {
    const data = await gather();
    const email = buildEmail(data);

    if (dryRun) {
      await pingHealthcheck(HC_SLUG, 'success');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        subject: email.subject,
        text: email.text,
        data,
      });
    }

    const sendResult = await sendResendEmail({
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (!sendResult.ok) {
      await pingHealthcheck(HC_SLUG, 'fail');
      log.error({ resend_error: sendResult.error ?? null }, 'slo-roundup send failed');
      return NextResponse.json(
        { ok: false, error: sendResult.error ?? 'send failed' },
        { status: 502 },
      );
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { sent_id: sendResult.id });
    log.info({ run_key: runKey, sent_id: sendResult.id, outcome: 'success' }, 'slo-roundup sent');
    return NextResponse.json({ ok: true, sentId: sendResult.id, runKey, summary: data });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/slo-roundup', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'slo-roundup threw');
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: 'slo-roundup failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
