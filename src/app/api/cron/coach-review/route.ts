import { NextRequest, NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { tryClaimCronRun, markCronRunComplete, thisWeekKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HC_SLUG = 'cron-coach-review';
const JOB_NAME = 'cron-coach-review';

// Auth: this route is in middleware's PUBLIC_API_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes. Fails CLOSED when CRON_SECRET is unset.
//
// Idempotency (round-3): one coach review per ET week. A Monday-morning
// Vercel retry for Sunday's run uses the same `thisWeekKeyET()` key so
// we don't double-call Anthropic ($$) or double-email Resend. Fails
// CLOSED on RPC error — a missed week is preferable to a duplicate
// LLM-cost spend + duplicate inbox send.
async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/coach-review' });

  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/coach-review',
    allowInternalKey: true,
  });
  if (!ok) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runKey = thisWeekKeyET();
  const claimed = await tryClaimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });
  if (!claimed) {
    log.info({ run_key: runKey, outcome: 'skipped_idempotent_or_rpc_err' }, 'coach-review skipped — already ran or claim RPC failed');
    return NextResponse.json({ ok: true, skipped: 'already_ran', runKey });
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey }, 'coach-review start');

  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);

    sendResendEmail({
      subject: `Weekly Coach Review — ${result.patterns_detected.length} pattern(s) flagged`,
      text: `Week of ${weekOf}\n\nTrade count: ${result.trade_count}\nP&L: $${result.pnl_usd.toFixed(2)}\n\nRule for next week:\n${result.primary_rule_for_next_week}\n\nPatterns:\n${result.patterns_detected.map(p => `- ${p.type} [${p.severity}]: ${p.evidence}`).join('\n')}\n\n${result.review_markdown.slice(0, 2000)}...\n\nFull review: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/journal/coach`,
    }).catch(() => {});

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { coach_review_id: id, week_of: weekOf });

    return NextResponse.json({
      week_of: weekOf,
      id,
      trade_count: result.trade_count,
      patterns_detected: result.patterns_detected,
      primary_rule_for_next_week: result.primary_rule_for_next_week,
      model: result.model_used,
      runKey,
    });
  } catch (err) {
    // Don't mark complete on failure — stale-window reclaim covers retries.
    const eventId = captureRouteError(err, { request_id, route: 'cron/coach-review', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'coach-review failed');
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: 'coach-review failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
