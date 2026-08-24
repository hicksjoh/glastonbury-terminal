import { NextRequest, NextResponse } from 'next/server';
import { runTaxHarvestScan, persistSuggestions } from '@/lib/tax-harvest-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { claimCronRun, markCronRunComplete, thisWeekKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HC_SLUG = 'cron-tax-harvest';
const JOB_NAME = 'cron-tax-harvest';

// Auth: this route is in middleware's PUBLIC_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes (Bearer/x-api-key CRON_SECRET, x-internal-key
// INTERNAL_API_KEY, signed gt-auth JWT). Fails CLOSED when CRON_SECRET
// is unset (Codex round-2 finding).
async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/tax-harvest' });

  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/tax-harvest',
    allowInternalKey: true,
  });
  if (!ok) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('mode') === 'dry-run';

  // D3 (2026-08 digest QA): this cron had no cron_runs claim. The manifest
  // called it "idempotent — unique index per week", but persistSuggestions()
  // DELETEs the week's 'suggested' rows and re-INSERTs them, so `inserted`
  // is non-zero again on a duplicate fire and the email goes out twice.
  //
  // Fail CLOSED: a duplicate lands in a real inbox, so a broken claim RPC
  // should skip rather than risk double-sending.
  const runKey = thisWeekKeyET();
  if (!dryRun) {
    const claim = await claimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });

    // D4: a broken claim RPC (e.g. 20260506_cron_run_idempotency.sql never
    // applied) must not masquerade as a successful dedup — fail-closed would
    // then skip this digest every single week while returning 200.
    if (claim.reason === 'rpc_error') {
      await pingHealthcheck(HC_SLUG, 'fail');
      const eventId = captureRouteError(
        new Error(`tax-harvest claim RPC failed: ${claim.error ?? 'unknown'}`),
        { request_id, route: 'cron/tax-harvest', run_key: runKey },
      );
      log.error(
        { run_key: runKey, err: claim.error ?? null, sentry_event_id: eventId },
        'tax-harvest claim RPC failed — skipping to avoid a double send',
      );
      return NextResponse.json(
        { ok: false, error: 'cron claim RPC failed', sentry_event_id: eventId, runKey },
        { status: 500 },
      );
    }

    if (!claim.claimed) {
      log.info({ run_key: runKey, outcome: 'skipped_idempotent' }, 'tax-harvest skipped — already ran this week');
      return NextResponse.json({ ok: true, skipped: 'already_ran_this_week', runKey });
    }
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey, dry_run: dryRun }, 'tax-harvest scan start');

  try {
    const suggestions = await runTaxHarvestScan();
    const { inserted, week_of } = await persistSuggestions('wes', suggestions);

    const summary = suggestions.map(s => ({
      ticker: s.position_ticker,
      loss: s.unrealized_loss,
      swap: s.swap_candidate_ticker,
      correlation: s.swap_correlation,
      wash_sale_safe: s.wash_sale_safe,
      estimated_tax_savings_usd: s.estimated_tax_savings_usd,
    }));

    // No candidates this week is a legitimate outcome, not a failure — but
    // it must be distinguishable from "the digest silently didn't send",
    // so it gets its own logged outcome and a completed run row.
    if (inserted === 0) {
      await pingHealthcheck(HC_SLUG, 'success');
      if (!dryRun) {
        await markCronRunComplete(JOB_NAME, runKey, { inserted: 0, emailed: false });
      }
      log.info({ run_key: runKey, outcome: 'no_candidates' }, 'tax-harvest found no candidates — no email sent');
      return NextResponse.json({ ok: true, week_of, runKey, suggestions_found: 0, inserted: 0, emailed: false, dryRun });
    }

    const totalSavings = suggestions.reduce((s, x) => s + x.estimated_tax_savings_usd, 0);
    const totalLoss = suggestions.reduce((s, x) => s + Math.abs(x.unrealized_loss), 0);
    const subject = `Tax-Loss Harvest — ${suggestions.length} candidates, $${totalSavings.toFixed(0)} potential savings`;
    const text = `Week of ${week_of}:\n\nTotal unrealized loss scanned: $${totalLoss.toFixed(0)}\nTotal estimated federal tax savings: $${totalSavings.toFixed(0)}\n\n${suggestions.map(s => `• ${s.position_ticker} (loss $${Math.abs(s.unrealized_loss).toFixed(0)}) → ${s.swap_candidate_ticker ?? 'no swap found'}${s.swap_correlation ? ` (corr ${s.swap_correlation.toFixed(3)})` : ''}${s.wash_sale_safe ? ' · wash-safe' : ' · WASH RISK'}`).join('\n')}\n\nReview & queue: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/tax/harvest/weekly`;

    if (dryRun) {
      await pingHealthcheck(HC_SLUG, 'success');
      log.info({ subject, dry_run: true }, 'tax-harvest dry-run complete');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        week_of,
        subject,
        textPreview: text.slice(0, 600),
        suggestions_found: suggestions.length,
        inserted,
        summary,
      });
    }

    // D2 (2026-08 digest QA): this was `sendResendEmail({...}).catch(() => {})`
    // — never awaited, so Vercel could freeze the instance mid-flight and drop
    // the send, and the empty .catch() hid every delivery failure.
    const sendResult = await sendResendEmail({ subject, text });

    if (!sendResult.ok) {
      await pingHealthcheck(HC_SLUG, 'fail');
      log.error({ run_key: runKey, resend_error: sendResult.error ?? null }, 'tax-harvest send failed');
      return NextResponse.json(
        { ok: false, error: sendResult.error ?? 'send failed', week_of, inserted },
        { status: 502 },
      );
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { inserted, sent_id: sendResult.id });
    log.info({ run_key: runKey, inserted, sent_id: sendResult.id, outcome: 'success' }, 'tax-harvest sent');

    return NextResponse.json({
      ok: true,
      week_of,
      runKey,
      sentId: sendResult.id,
      suggestions_found: suggestions.length,
      inserted,
      emailed: true,
      summary,
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/tax-harvest', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'tax-harvest scan failed');
    // Not marking complete — the stale window lets a manual retry reclaim.
    await pingHealthcheck(HC_SLUG, 'fail');
    // Don't echo raw error message to caller (Codex finding) — pull details from Sentry by eventId.
    return NextResponse.json({ error: 'tax-harvest scan failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
