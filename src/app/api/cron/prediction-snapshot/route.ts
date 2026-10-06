import { NextRequest, NextResponse } from 'next/server';
import { takePredictionSnapshot } from '@/lib/prediction-markets';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';
import { GET as refreshNarrative } from '@/app/api/narrative/route';
import { recordCronRan } from '@/lib/cron-idempotency';
import { MARKER_JOBS, NARRATIVE_SCHEDULES, narrativeJobName } from '@/lib/cron-freshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HC_SLUG = 'cron-prediction-snapshot';

// Auth: this route is in middleware's PUBLIC_API_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes. Fails CLOSED when CRON_SECRET is unset.
async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/prediction-snapshot' });

  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/prediction-snapshot',
  });
  if (!ok) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Reuse this middleware-allowlisted, self-authenticated cron endpoint for
  // the narrative schedule (a new cron route would require editing the
  // untouchable middleware allowlist). Vercel's blessed way to share one
  // path across schedules is the x-vercel-cron-schedule header — query
  // strings in cron paths are undocumented and may be stripped, which would
  // silently run a prediction snapshot instead. ?job=narrative is kept for
  // manual/curl invocations. NARRATIVE_SCHEDULES lives in
  // src/lib/cron-freshness.ts, whose unit test pins it to vercel.json.
  const cronSchedule = req.headers.get('x-vercel-cron-schedule');
  const isNarrativeJob =
    req.nextUrl.searchParams.get('job') === 'narrative' ||
    (cronSchedule !== null && NARRATIVE_SCHEDULES.includes(cronSchedule));
  if (isNarrativeJob) {
    const narrativeReq = new Request(new URL('/api/narrative?refresh=true', req.url));
    const response = await refreshNarrative(narrativeReq);
    if (!response.ok) {
      log.error({ status: response.status }, 'scheduled narrative refresh failed');
    } else {
      log.info('scheduled narrative refresh complete');
      // Dead-man marker, per schedule, and only for a scheduled run whose
      // refresh did not fail. /api/narrative answers 200 with
      // `refreshFailed: true` when it fell back to the stored narrative; that
      // is not evidence the job works. An unreadable body is treated the same.
      if (cronSchedule !== null && NARRATIVE_SCHEDULES.includes(cronSchedule)) {
        const body: unknown = await response.clone().json().catch(() => null);
        const flags = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
        if (flags && flags.refreshFailed !== true && typeof flags.timestamp === 'string') {
          await recordCronRan(narrativeJobName(cronSchedule), {
            regenerated: flags.cached === false,
            narrative_timestamp: flags.timestamp,
          });
        } else {
          log.warn('narrative refresh answered 200 without a fresh narrative; no dead-man marker written');
        }
      }
    }
    return response;
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info('prediction-snapshot start');

  try {
    const result = await takePredictionSnapshot();
    log.info({ inserted: result.inserted, deltas: result.deltas.length }, 'prediction-snapshot success');
    await pingHealthcheck(HC_SLUG, 'success');
    // An empty Kalshi/Polymarket feed inserts nothing, so leave a marker for
    // the dead-man check rather than relying on prediction_market_snapshots.
    await recordCronRan(MARKER_JOBS.predictionSnapshot, { inserted: result.inserted });
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      summary: result.deltas.map(d => ({
        source: d.source,
        ticker: d.market_ticker,
        name: d.market_name.slice(0, 80),
        yes: d.yes_price,
        delta_24h: d.delta_24h,
      })),
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/prediction-snapshot' });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'prediction-snapshot failed');
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: 'prediction-snapshot failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
