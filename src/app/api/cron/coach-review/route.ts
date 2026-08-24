import { NextRequest, NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { claimCronRun, markCronRunComplete, thisWeekKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HC_SLUG = 'cron-coach-review';
const JOB_NAME = 'cron-coach-review';

// Auth: this route is in middleware's PUBLIC_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes. Fails CLOSED when CRON_SECRET is unset.
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

  const dryRun = req.nextUrl.searchParams.get('mode') === 'dry-run';

  // D3 (2026-08 digest QA): this cron had no cron_runs claim. The manifest
  // called it "idempotent — unique per weekOf", but persistCoachReview()
  // DELETEs the week's row and re-INSERTs it, and the email was sent
  // unconditionally afterwards. A duplicate fire therefore burned a second
  // Opus call and delivered a second copy of the digest.
  //
  // Fail CLOSED like weekly-report: a duplicate lands in a real inbox and
  // costs a full Opus review, so a broken claim RPC should skip, not send.
  const runKey = thisWeekKeyET();
  if (!dryRun) {
    const claim = await claimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });

    // D4: a broken claim RPC (e.g. 20260506_cron_run_idempotency.sql never
    // applied) must not masquerade as a successful dedup — fail-closed would
    // then skip this digest every single week while returning 200.
    if (claim.reason === 'rpc_error') {
      await pingHealthcheck(HC_SLUG, 'fail');
      const eventId = captureRouteError(
        new Error(`coach-review claim RPC failed: ${claim.error ?? 'unknown'}`),
        { request_id, route: 'cron/coach-review', run_key: runKey },
      );
      log.error(
        { run_key: runKey, err: claim.error ?? null, sentry_event_id: eventId },
        'coach-review claim RPC failed — skipping to avoid a double send',
      );
      return NextResponse.json(
        { ok: false, error: 'cron claim RPC failed', sentry_event_id: eventId, runKey },
        { status: 500 },
      );
    }

    if (!claim.claimed) {
      log.info({ run_key: runKey, outcome: 'skipped_idempotent' }, 'coach-review skipped — already ran this week');
      return NextResponse.json({ ok: true, skipped: 'already_ran_this_week', runKey });
    }
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey, dry_run: dryRun }, 'coach-review start');

  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);

    const subject = `Weekly Coach Review — ${result.patterns_detected.length} pattern(s) flagged`;
    const text = `Week of ${weekOf}\n\nTrade count: ${result.trade_count}\nP&L: $${result.pnl_usd.toFixed(2)}\n\nRule for next week:\n${result.primary_rule_for_next_week}\n\nPatterns:\n${result.patterns_detected.map(p => `- ${p.type} [${p.severity}]: ${p.evidence}`).join('\n')}\n\n${result.review_markdown.slice(0, 2000)}...\n\nFull review: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/journal/coach`;

    if (dryRun) {
      await pingHealthcheck(HC_SLUG, 'success');
      log.info({ subject, dry_run: true }, 'coach-review dry-run complete');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        week_of: weekOf,
        subject,
        textPreview: text.slice(0, 600),
      });
    }

    // D2 (2026-08 digest QA): this was `sendResendEmail({...}).catch(() => {})`
    // — never awaited. Vercel can freeze the function instance the moment the
    // response is returned, killing the in-flight POST to Resend, so the
    // digest arrived some weeks and not others. The empty .catch() also
    // swallowed every delivery failure: no log, no Sentry, no HC 'fail'.
    const sendResult = await sendResendEmail({ subject, text });

    if (!sendResult.ok) {
      await pingHealthcheck(HC_SLUG, 'fail');
      log.error({ run_key: runKey, resend_error: sendResult.error ?? null }, 'coach-review send failed');
      // The review itself persisted; only delivery failed. Surface it as a
      // 502 so Vercel's log + Healthchecks both show red.
      return NextResponse.json(
        { ok: false, error: sendResult.error ?? 'send failed', week_of: weekOf, id },
        { status: 502 },
      );
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { review_id: id, sent_id: sendResult.id });
    log.info({ run_key: runKey, sent_id: sendResult.id, outcome: 'success' }, 'coach-review sent');

    return NextResponse.json({
      week_of: weekOf,
      id,
      runKey,
      sentId: sendResult.id,
      trade_count: result.trade_count,
      patterns_detected: result.patterns_detected,
      primary_rule_for_next_week: result.primary_rule_for_next_week,
      model: result.model_used,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/coach-review', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'coach-review failed');
    // Not marking complete — the stale window lets a manual retry reclaim.
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: 'coach-review failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
