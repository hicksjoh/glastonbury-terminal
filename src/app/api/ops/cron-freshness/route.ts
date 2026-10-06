import { NextResponse } from 'next/server';
import vercelConfig from '../../../../../vercel.json';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';
import {
  cronEvidenceKey,
  evaluateCronFreshness,
  isHealthyCronStatus,
  registryEntryFor,
  type CronEvidenceSource,
  type CronScheduleEntry,
} from '@/lib/cron-freshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Outcome of one evidence read. `ok: false` must surface as `unverifiable`. */
type EvidenceRead = { ok: true; at: string | null } | { ok: false; reason: string };

/**
 * Latest evidence for one source. Every failure mode — a Supabase error, a
 * throw, a value that is not a string, a source kind this function does not
 * know — returns `ok: false`. Only a successful read with zero rows is
 * `{ ok: true, at: null }` (never ran).
 */
async function readEvidence(sb: ServiceClient, source: CronEvidenceSource): Promise<EvidenceRead> {
  try {
    let column: string;
    let query;
    if (source.kind === 'cron_runs') {
      column = 'completed_at';
      query = sb.from('cron_runs').select('completed_at').eq('job_name', source.jobName);
    } else if (source.kind === 'table') {
      column = source.column;
      query = sb.from(source.table).select(source.column);
    } else {
      return { ok: false, reason: 'unknown evidence source kind' };
    }
    const { data, error } = await query
      .not(column, 'is', null)
      .order(column, { ascending: false })
      .limit(1);
    if (error) return { ok: false, reason: error.message };
    if (!Array.isArray(data)) return { ok: false, reason: 'evidence read returned no row array' };
    if (data.length === 0) return { ok: true, at: null };
    const value = (data[0] as unknown as Record<string, unknown> | null)?.[column];
    if (typeof value !== 'string' || value.length === 0) {
      return { ok: false, reason: `evidence column ${column} is not a string` };
    }
    return { ok: true, at: value };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// GET /api/ops/cron-freshness — did every scheduled job leave evidence lately?
// Auth: middleware (session cookie). Asserted nightly by
// e2e/truth-invariants.spec.ts and shown on /settings.
async function GET_impl() {
  const now = new Date();
  const rawCrons: unknown = (vercelConfig as { crons?: unknown }).crons;

  // The cron list is an input too, so its shape is checked: a missing or
  // malformed list is a failed check, not an empty (and therefore "ok") one.
  // A malformed entry is kept as a row so it shows up as `unverifiable`.
  const crons: CronScheduleEntry[] = [];
  let listValid = Array.isArray(rawCrons) && rawCrons.length > 0;
  if (Array.isArray(rawCrons)) {
    for (const c of rawCrons) {
      const path = (c as { path?: unknown } | null)?.path;
      const schedule = (c as { schedule?: unknown } | null)?.schedule;
      if (typeof path !== 'string' || typeof schedule !== 'string') listValid = false;
      crons.push({
        path: typeof path === 'string' ? path : '(malformed vercel.json cron entry)',
        schedule: typeof schedule === 'string' ? schedule : '',
      });
    }
  }

  // One read per distinct evidence key. A key enters the map ONLY when its
  // read succeeded; an absent key is what evaluateCronFreshness turns into
  // `unverifiable`.
  const evidence: Record<string, string | null> = {};
  let sb: ServiceClient | null = null;
  try {
    sb = createServiceClient();
  } catch (err) {
    console.error('[cron-freshness] Supabase client unavailable:', err instanceof Error ? err.message : String(err));
  }
  if (sb) {
    const client = sb;
    const sources = new Map<string, CronEvidenceSource>();
    for (const cron of crons) {
      const entry = registryEntryFor(cron);
      if (entry) sources.set(cronEvidenceKey(cron), entry.evidence);
    }
    await Promise.all(
      Array.from(sources.entries()).map(async ([key, source]) => {
        const read = await readEvidence(client, source);
        if (read.ok) {
          evidence[key] = read.at;
        } else {
          console.error(`[cron-freshness] evidence read failed for ${key}:`, read.reason);
        }
      }),
    );
  }

  const rows = evaluateCronFreshness(now, crons, evidence);
  const ok = listValid && rows.length > 0 && rows.every(r => isHealthyCronStatus(r.status));

  return NextResponse.json({
    ok,
    checkedAt: now.toISOString(),
    crons: rows,
  });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6).
export const GET = withRateLimit('ops/cron-freshness', RATE.READ, GET_impl);
