import { NextRequest, NextResponse } from 'next/server';
import {
  evaluateStorms,
  fetchNhcActiveStorms,
  loadTerritoryZips,
  miamiMockStorm,
  persistAlertCandidates,
} from '@/lib/storm-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Vercel cron + CRON_SECRET auth.
// GET is what Vercel uses by default; POST is supported for manual runs.
// Query `?mock=miami` injects a synthetic Miami-bound storm for QA.
async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('authorization') ?? '';
    const headerKey = req.headers.get('x-api-key') ?? '';
    const ok = header === `Bearer ${cronSecret}` || headerKey === cronSecret;
    // Vercel cron sends the header; allow mock param in dev without auth.
    const mock = req.nextUrl.searchParams.get('mock');
    if (!ok && !mock) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const mock = req.nextUrl.searchParams.get('mock');
  const storms = mock === 'miami' ? [miamiMockStorm()] : await fetchNhcActiveStorms();
  const zipMap = await loadTerritoryZips();
  const candidates = evaluateStorms(storms, zipMap);

  const persisted = await persistAlertCandidates(candidates);

  return NextResponse.json({
    ok: true,
    mock: !!mock,
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
}

export const GET = handle;
export const POST = handle;
