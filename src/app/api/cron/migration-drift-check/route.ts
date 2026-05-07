import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { tryClaimCronRun, markCronRunComplete, thisWeekKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// p6-4: catch the "shipped code, forgot to apply migration" class of bug.
//
// Opus audit found three live examples right now:
//   - 20260506_oauth_client_lifecycle.sql — silently fails OPEN if not
//     applied. revoked_at column undefined → revocation doesn't work.
//   - 20260506_oauth_consent_transactions.sql — fails closed but with a
//     confusing "Internal error" message that masks the root cause.
//   - 20260506_cron_run_idempotency.sql — fails open by design; cron
//     duplicates start happening silently.
//
// Strategy: weekly canary cron. Each canary queries information_schema
// for a specific table or column that should exist after the migration
// applies. If any are missing, email Wes with the exact migration to run.
//
// Schedule: Mondays 9:00 AM EDT (`0 13 * * 1` UTC) — start-of-week, fresh
// inbox. Idempotent per ISO-week.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HC_SLUG = 'migration-drift-check';
const JOB_NAME = 'migration-drift-check';

// Each canary: a database object that should exist after the named
// migration applies. Add a row when adding a new migration.
interface Canary {
  migration: string;       // filename under supabase/migrations/
  description: string;
  check: 'table' | 'column';
  schema: string;
  tableName: string;
  columnName?: string;     // required when check === 'column'
}

const CANARIES: Canary[] = [
  // Week 1 hardening
  {
    migration: '20260506_cron_run_idempotency.sql',
    description: 'Cron run idempotency (cron_runs table)',
    check: 'table',
    schema: 'public',
    tableName: 'cron_runs',
  },
  // Week 2 hardening
  {
    migration: '20260506_oauth_client_lifecycle.sql',
    description: 'OAuth client revocation (oauth_clients.revoked_at)',
    check: 'column',
    schema: 'public',
    tableName: 'oauth_clients',
    columnName: 'revoked_at',
  },
  {
    migration: '20260506_oauth_client_lifecycle.sql',
    description: 'OAuth client usage tracking (oauth_clients.last_used_at)',
    check: 'column',
    schema: 'public',
    tableName: 'oauth_clients',
    columnName: 'last_used_at',
  },
  // Week 3 hardening
  {
    migration: '20260506_oauth_consent_transactions.sql',
    description: 'OAuth consent transaction binding (oauth_consent_transactions table)',
    check: 'table',
    schema: 'public',
    tableName: 'oauth_consent_transactions',
  },
  // Add new canaries as new migrations land.
];

interface CanaryResult {
  canary: Canary;
  exists: boolean;
  error?: string;
}

async function runCanaries(supabase: ReturnType<typeof createServiceClient>): Promise<CanaryResult[]> {
  const results: CanaryResult[] = [];

  for (const c of CANARIES) {
    try {
      if (c.check === 'table') {
        const { data, error } = await supabase
          .from('information_schema.tables' as never)
          .select('table_name')
          .eq('table_schema', c.schema)
          .eq('table_name', c.tableName)
          .maybeSingle();
        // PostgREST may not expose information_schema directly. Fall back
        // to a probe SELECT that errors with "relation does not exist" if
        // the table isn't there.
        if (error && /relation .* does not exist/i.test(error.message ?? '')) {
          results.push({ canary: c, exists: false });
          continue;
        }
        if (error) {
          // Try direct probe
          const probe = await supabase.from(c.tableName as never).select('*', { head: true, count: 'exact' }).limit(0);
          results.push({
            canary: c,
            exists: !probe.error || !/relation .* does not exist/i.test(probe.error.message ?? ''),
            error: probe.error?.message,
          });
          continue;
        }
        results.push({ canary: c, exists: !!data });
      } else {
        // column check via information_schema; fall back to probe
        const { data, error } = await supabase
          .from('information_schema.columns' as never)
          .select('column_name')
          .eq('table_schema', c.schema)
          .eq('table_name', c.tableName)
          .eq('column_name', c.columnName!)
          .maybeSingle();
        if (error) {
          // Fall back: select just that column, head-only.
          const probe = await supabase.from(c.tableName as never).select(c.columnName!, { head: true, count: 'exact' }).limit(0);
          results.push({
            canary: c,
            exists: !probe.error,
            error: probe.error?.message,
          });
          continue;
        }
        results.push({ canary: c, exists: !!data });
      }
    } catch (err) {
      results.push({
        canary: c,
        exists: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

function buildAlertEmail(missing: CanaryResult[]): { subject: string; text: string; html: string } {
  const subject = `🚨 MIGRATION DRIFT — ${missing.length} migration${missing.length === 1 ? '' : 's'} not applied`;
  const lines: string[] = [];
  lines.push(`Migration drift detected — ${missing.length} expected database object${missing.length === 1 ? ' is' : 's are'} missing.`);
  lines.push('');
  lines.push('UNAPPLIED MIGRATIONS:');
  // Group by migration filename (one migration may add multiple objects)
  const byMigration = new Map<string, CanaryResult[]>();
  for (const r of missing) {
    const list = byMigration.get(r.canary.migration) ?? [];
    list.push(r);
    byMigration.set(r.canary.migration, list);
  }
  Array.from(byMigration.entries()).forEach(([migration, results]) => {
    lines.push(`  • ${migration}`);
    for (const r of results) {
      lines.push(`      missing: ${r.canary.description}`);
      if (r.error) lines.push(`      probe error: ${r.error}`);
    }
  });
  lines.push('');
  lines.push('TO FIX:');
  lines.push('  1. Open the Supabase dashboard for this project');
  lines.push('  2. SQL Editor → paste the contents of each migration file above');
  lines.push('  3. Run, in alphabetical order (timestamps are designed for this)');
  lines.push('  4. Re-run this cron manually to confirm:');
  lines.push('       curl -H "Authorization: Bearer $CRON_SECRET" https://terminal.johnwesleyhicks.com/api/cron/migration-drift-check?mode=dry-run');
  lines.push('');
  lines.push('— Glastonbury Terminal · automated weekly migration drift check');

  const text = lines.join('\n');
  const html = `<pre style="font-family: ui-monospace, monospace; line-height: 1.55; color: #e8e8e8; background: #08080d; padding: 24px;">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;
  return { subject, text, html };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/migration-drift-check' });

  if (!(await cronIsAuthorized(req, { routeName: '/api/cron/migration-drift-check' }))) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('mode') === 'dry-run';
  const runKey = thisWeekKeyET();

  if (!dryRun) {
    const claimed = await tryClaimCronRun(JOB_NAME, runKey);
    if (!claimed) {
      log.info({ run_key: runKey, outcome: 'skipped_idempotent' }, 'migration-drift-check already ran this week');
      return NextResponse.json({ ok: true, skipped: 'already_ran_this_week', runKey });
    }
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey, dry_run: dryRun, canaries: CANARIES.length }, 'migration-drift-check start');

  try {
    const supabase = createServiceClient();
    const results = await runCanaries(supabase);
    const missing = results.filter(r => !r.exists);

    if (dryRun) {
      await pingHealthcheck(HC_SLUG, 'success');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        canaries_total: results.length,
        canaries_missing: missing.length,
        results: results.map(r => ({
          migration: r.canary.migration,
          description: r.canary.description,
          exists: r.exists,
          error: r.error,
        })),
      });
    }

    if (missing.length > 0) {
      const email = buildAlertEmail(missing);
      log.error({ missing_count: missing.length, missing: missing.map(m => m.canary.migration) }, 'migration drift detected');
      const sendResult = await sendResendEmail({
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      await pingHealthcheck(HC_SLUG, sendResult.ok ? 'success' : 'fail');
      await markCronRunComplete(JOB_NAME, runKey, {
        missing_count: missing.length,
        sent_id: sendResult.id ?? null,
        send_ok: sendResult.ok,
      });
      return NextResponse.json({
        ok: true,
        drift: true,
        missing_count: missing.length,
        sent_id: sendResult.id,
      });
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { missing_count: 0 });
    log.info({ run_key: runKey, canaries: results.length, outcome: 'no_drift' }, 'migration-drift-check clean');
    return NextResponse.json({
      ok: true,
      drift: false,
      canaries_total: results.length,
      runKey,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/migration-drift-check', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'migration-drift-check threw');
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: 'migration-drift-check failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
