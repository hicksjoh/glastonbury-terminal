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
import { tryClaimCronRun, markCronRunComplete, todayKeyET } from '@/lib/cron-idempotency';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HC_SLUG = 'cron-storm-watch';
const JOB_NAME = 'cron-storm-watch';

// Vercel cron + CRON_SECRET auth.
// GET is what Vercel uses by default; POST is supported for manual runs.
// Query `?mock=miami` injects a synthetic Miami-bound storm for QA — but
// only outside production AND with valid auth (Codex round-2 finding:
// the bare `if (!ok && !mock)` branch let unauth requests through).
//
// Auth: this route is in middleware's PUBLIC_API_ROUTES. See
// src/lib/cron-auth.ts for the full doc on accepted auth modes. Fails
// CLOSED when CRON_SECRET is unset.
//
// Idempotency (round-3): one persist+alert per ET day. A Vercel retry
// would otherwise re-insert alert candidates and (once notification
// fan-out is wired) re-notify Wes about the same storm. Fails CLOSED
// on RPC error — a missed scan is recoverable (NHC data updates every
// few hours); duplicate alerts are not.
//   - Mock-mode (`?mock=miami`) skips the claim so QA invocations don't
//     burn the slot for the day's real cron.
async function handle(req: NextRequest): Promise<NextResponse> {
  const { log, request_id } = loggerFor(req, { route: 'cron/storm-watch' });

  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/storm-watch',
  });
  if (!ok) {
    log.warn('unauthorized cron call');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mockParam = req.nextUrl.searchParams.get('mock');
  // Mock storm injection is QA-only: gated to non-production environments
  // even after passing auth. Production cron always pulls live NHC data.
  const allowMock = mockParam === 'miami' && process.env.NODE_ENV !== 'production';

  const runKey = todayKeyET();
  if (!allowMock) {
    const claimed = await tryClaimCronRun(JOB_NAME, runKey, { onRpcError: 'closed' });
    if (!claimed) {
      log.info({ run_key: runKey, outcome: 'skipped_idempotent_or_rpc_err' }, 'storm-watch skipped — already ran or claim RPC failed');
      return NextResponse.json({ ok: true, skipped: 'already_ran', runKey });
    }
  }

  await pingHealthcheck(HC_SLUG, 'start');
  log.info({ run_key: runKey, mock: allowMock }, 'storm-watch scan start');

  try {
    const storms = allowMock ? [miamiMockStorm()] : await fetchNhcActiveStorms();
    const zipMap = await loadTerritoryZips();
    const candidates = evaluateStorms(storms, zipMap);

    const persisted = await persistAlertCandidates(candidates);

    await pingHealthcheck(HC_SLUG, 'success');
    if (!allowMock) {
      await markCronRunComplete(JOB_NAME, runKey, {
        storms_seen: storms.length,
        candidates: candidates.length,
        created: persisted.created,
      });
    }

    return NextResponse.json({
      ok: true,
      mock: allowMock,
      stormsSeen: storms.length,
      candidates: candidates.length,
      created: persisted.created,
      unchanged: persisted.unchanged,
      runKey,
      candidatesSummary: candidates.map(c => ({
        storm_id: c.storm_id,
        storm_name: c.storm_name,
        threat_level: c.threat_level,
        impacted_territories: c.impacted_territory_ids.length,
        impacted_zips: c.impacted_zips.length,
      })),
    });
  } catch (err) {
    // Don't mark complete on failure — stale-window reclaim covers retries.
    const eventId = captureRouteError(err, { request_id, route: 'cron/storm-watch', run_key: runKey });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'storm-watch failed');
    await pingHealthcheck(HC_SLUG, 'fail');
    // Generic message — don't leak NHC/Supabase internals via raw err string.
    return NextResponse.json({ error: 'storm-watch failed', sentry_event_id: eventId }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
