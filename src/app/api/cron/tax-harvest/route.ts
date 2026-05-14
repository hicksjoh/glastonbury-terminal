import { NextRequest, NextResponse } from 'next/server';
import { runTaxHarvestScan, persistSuggestions } from '@/lib/tax-harvest-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { tryClaimCronRun, markCronRunComplete, todayKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HC_SLUG = 'cron-tax-harvest';
const JOB_NAME = 'cron-tax-harvest';

// Auth: this route is in middleware's PUBLIC_API_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes (Bearer/x-api-key CRON_SECRET, x-internal-key
// INTERNAL_API_KEY, signed gt-auth JWT). Fails CLOSED when CRON_SECRET
// is unset (Codex round-2 finding).
//
// Idempotency (round-3): one persist+email per ET day. A Vercel retry
// for today's run (network blip, cold-start timeout, manual rerun) uses
// the same `todayKeyET()` key so we don't double-insert suggestions or
// double-email. Fails CLOSED on RPC error — a missed day is preferable
// to duplicate Resend sends + duplicate DB rows.
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

  const runKey = todayKeyET();
  const claimed = await tryClaimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });
  if (!claimed) {
    log.info({ run_key: runKey, outcome: 'skipped_idempotent_or_rpc_err' }, 'tax-harvest skipped — already ran or claim RPC failed');
    return NextResponse.json({ ok: true, skipped: 'already_ran', runKey });
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey }, 'tax-harvest scan start');

  try {
    const suggestions = await runTaxHarvestScan();
    const { inserted, week_of } = await persistSuggestions('wes', suggestions);

    if (inserted > 0) {
      const totalSavings = suggestions.reduce((s, x) => s + x.estimated_tax_savings_usd, 0);
      const totalLoss = suggestions.reduce((s, x) => s + Math.abs(x.unrealized_loss), 0);
      sendResendEmail({
        subject: `Tax-Loss Harvest — ${suggestions.length} candidates, $${totalSavings.toFixed(0)} potential savings`,
        text: `Week of ${week_of}:\n\nTotal unrealized loss scanned: $${totalLoss.toFixed(0)}\nTotal estimated federal tax savings: $${totalSavings.toFixed(0)}\n\n${suggestions.map(s => `• ${s.position_ticker} (loss $${Math.abs(s.unrealized_loss).toFixed(0)}) → ${s.swap_candidate_ticker ?? 'no swap found'}${s.swap_correlation ? ` (corr ${s.swap_correlation.toFixed(3)})` : ''}${s.wash_sale_safe ? ' · wash-safe' : ' · WASH RISK'}`).join('\n')}\n\nReview & queue: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/tax/harvest/weekly`,
      }).catch(() => {});
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { inserted, suggestions: suggestions.length });

    return NextResponse.json({
      week_of,
      suggestions_found: suggestions.length,
      inserted,
      runKey,
      summary: suggestions.map(s => ({
        ticker: s.position_ticker,
        loss: s.unrealized_loss,
        swap: s.swap_candidate_ticker,
        correlation: s.swap_correlation,
        wash_sale_safe: s.wash_sale_safe,
        estimated_tax_savings_usd: s.estimated_tax_savings_usd,
      })),
    });
  } catch (err) {
    // Don't mark complete on failure — stale-window reclaim covers retries.
    const eventId = captureRouteError(err, { request_id, route: 'cron/tax-harvest', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'tax-harvest scan failed');
    await pingHealthcheck(HC_SLUG, 'fail');
    // Don't echo raw error message to caller (Codex finding) — pull details from Sentry by eventId.
    return NextResponse.json({ error: 'tax-harvest scan failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
