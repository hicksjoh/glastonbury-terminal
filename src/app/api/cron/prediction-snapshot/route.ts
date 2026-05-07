import { NextRequest, NextResponse } from 'next/server';
import { takePredictionSnapshot } from '@/lib/prediction-markets';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

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

  await pingHealthcheck(HC_SLUG, 'start');
  log.info('prediction-snapshot start');

  try {
    const result = await takePredictionSnapshot();
    log.info({ inserted: result.inserted, deltas: result.deltas.length }, 'prediction-snapshot success');
    await pingHealthcheck(HC_SLUG, 'success');
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
