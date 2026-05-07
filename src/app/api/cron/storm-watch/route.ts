import { NextRequest, NextResponse } from 'next/server';
import {
  evaluateStorms,
  fetchNhcActiveStorms,
  loadTerritoryZips,
  miamiMockStorm,
  persistAlertCandidates,
} from '@/lib/storm-engine';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HC_SLUG = 'cron-storm-watch';

// Vercel cron + CRON_SECRET auth.
// GET is what Vercel uses by default; POST is supported for manual runs.
// Query `?mock=miami` injects a synthetic Miami-bound storm for QA — but
// only outside production AND with valid auth (Codex round-2 finding:
// the bare `if (!ok && !mock)` branch let unauth requests through).
//
// Auth: this route is in middleware's PUBLIC_API_ROUTES. See
// src/lib/cron-auth.ts for the full doc on accepted auth modes. Fails
// CLOSED when CRON_SECRET is unset.
async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/storm-watch' });

  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/storm-watch',
  });
  if (!ok) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info('storm-watch scan start');

  try {
    const mockParam = req.nextUrl.searchParams.get('mock');
    // Mock storm injection is QA-only: gated to non-production environments
    // even after passing auth. Production cron always pulls live NHC data.
    const allowMock = mockParam === 'miami' && process.env.NODE_ENV !== 'production';
    const storms = allowMock ? [miamiMockStorm()] : await fetchNhcActiveStorms();
    const zipMap = await loadTerritoryZips();
    const candidates = evaluateStorms(storms, zipMap);

    const persisted = await persistAlertCandidates(candidates);

    await pingHealthcheck(HC_SLUG, 'success');

    return NextResponse.json({
      ok: true,
      mock: allowMock,
      stormsSeen: storms.length,
      candidates: candidates.length,
      created: persisted.created,
      unchanged: persisted.unchanged,
      candidatesSummary: candidates.map(c => ({
        storm_id: c.storm_id,
        storm_name: c.storm_name,
        threat_level: c.threat_level,
        impacted_territories: c.impacted_territory_ids.length,
        impacted_zips: c.impacted_zips.length,
      })),
    });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'cron/storm-watch' });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'storm-watch failed');
    await pingHealthcheck(HC_SLUG, 'fail');
    // Generic message — don't leak NHC/Supabase internals via raw err string.
    return NextResponse.json({ error: 'storm-watch failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
