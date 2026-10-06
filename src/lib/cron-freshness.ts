/**
 * In-app dead-man check for the scheduled jobs in vercel.json.
 *
 * Why this exists: the daily portfolio snapshot cron 401'd on every run for
 * months and never wrote a row, and nothing noticed. src/lib/healthchecks.ts is
 * fail-open and HEALTHCHECKS_PING_KEY is not set in production, so no ping has
 * ever fired. This module answers "did each cron leave evidence recently
 * enough?" from our own database, and the nightly prod run asserts on it
 * (/api/ops/cron-freshness, e2e/truth-invariants.spec.ts).
 *
 * Pure on purpose: no I/O, no clock. The route supplies `now`, the cron list
 * and the evidence it read; everything here is unit-tested.
 *
 * Design rule (team lesson): a guard's failure mode is the shape it silently
 * does not scan. So every unknown shape FAILS CLOSED as `unverifiable`:
 *   - a cron in vercel.json with no registry entry
 *   - a schedule this module cannot parse
 *   - evidence that could not be read, or is not a parseable timestamp
 * Nothing is ever skipped, and nothing unknown is ever reported `fresh`.
 */

export type CronStatus = 'fresh' | 'overdue' | 'never_ran' | 'unverifiable';

/** Where the latest proof-of-run for a cron lives. */
export type CronEvidenceSource =
  /** Latest `completed_at` in `cron_runs` for this job (20260506_cron_run_idempotency.sql). */
  | { kind: 'cron_runs'; jobName: string }
  /** Latest value of `column` in `table`. `date` columns carry no time of day. */
  | { kind: 'table'; table: string; column: string; granularity: 'timestamp' | 'date' };

export interface CronRegistryEntry {
  /** Human name shown in Settings and in nightly failure messages. */
  name: string;
  /**
   * Slack added on top of the longest gap between two scheduled firings.
   * Covers run duration, Vercel's cron jitter and one retry. Date-granularity
   * evidence needs a full extra day because the row says which day, not when.
   */
  graceHours: number;
  evidence: CronEvidenceSource;
}

export interface CronScheduleEntry {
  path: string;
  schedule: string;
}

export interface CronFreshnessRow {
  path: string;
  name: string;
  schedule: string;
  status: CronStatus;
  lastEvidenceAt: string | null;
  maxAgeHours: number | null;
  /** Why a row is not `fresh`. Absent on fresh rows. */
  detail?: string;
}

/**
 * /api/cron/prediction-snapshot serves two jobs off one path: these schedules
 * refresh the market narrative, every other schedule takes the prediction
 * snapshot. The route imports this list, so the dispatcher and the dead-man
 * check cannot drift apart.
 */
export const NARRATIVE_SCHEDULES: readonly string[] = ['30 13 * * 1-5', '0 18 * * 1-5'];

/** cron_runs job name for a narrative refresh fired by a given schedule. */
export function narrativeJobName(schedule: string): string {
  return `narrative-refresh@${schedule}`;
}

/** cron_runs job names for crons that only leave a "ran at" marker. */
export const MARKER_JOBS = {
  predictionSnapshot: 'cron-prediction-snapshot',
  stormWatch: 'cron-storm-watch',
  taxHarvest: 'cron-tax-harvest',
} as const;

const DAILY_GRACE_HOURS = 3;
const WEEKLY_GRACE_HOURS = 24;

/**
 * Keyed by route path, or by `path@schedule` where one path carries more than
 * one job. A path that has ONLY `path@schedule` keys (prediction-snapshot) is
 * deliberate: a new schedule on that path matches nothing and comes back
 * `unverifiable` until someone decides what evidence it leaves.
 */
export const CRON_REGISTRY: Readonly<Record<string, CronRegistryEntry>> = {
  '/api/briefing/morning-push': {
    name: 'Morning push',
    graceHours: DAILY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: 'briefing-morning-push' },
  },
  '/api/briefing/scheduled': {
    name: 'Scheduled briefing',
    graceHours: DAILY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: 'briefing-scheduled' },
  },
  [`/api/cron/prediction-snapshot@${NARRATIVE_SCHEDULES[0]}`]: {
    name: 'Narrative refresh (open)',
    graceHours: DAILY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: narrativeJobName(NARRATIVE_SCHEDULES[0]) },
  },
  [`/api/cron/prediction-snapshot@${NARRATIVE_SCHEDULES[1]}`]: {
    name: 'Narrative refresh (midday)',
    graceHours: DAILY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: narrativeJobName(NARRATIVE_SCHEDULES[1]) },
  },
  '/api/cron/prediction-snapshot@0 13 * * *': {
    name: 'Prediction-market snapshot',
    graceHours: DAILY_GRACE_HOURS,
    // Marker, not prediction_market_snapshots.snapshot_at: an empty Kalshi /
    // Polymarket feed inserts nothing, and a quiet feed is not a dead cron.
    evidence: { kind: 'cron_runs', jobName: MARKER_JOBS.predictionSnapshot },
  },
  '/api/cron/weekly-report': {
    name: 'Weekly report',
    graceHours: WEEKLY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: 'weekly-report' },
  },
  '/api/portfolio/snapshot': {
    name: 'Portfolio snapshot',
    // `date` is a calendar day; read as 00:00 UTC it can understate the run by
    // up to a day, so it gets a day of slack on top of the usual grace.
    graceHours: DAILY_GRACE_HOURS + 24,
    evidence: { kind: 'table', table: 'portfolio_snapshots', column: 'date', granularity: 'date' },
  },
  '/api/cron/storm-watch': {
    name: 'Storm watch',
    graceHours: DAILY_GRACE_HOURS,
    // Marker: a scan with no active storm writes no storm_alerts row.
    evidence: { kind: 'cron_runs', jobName: MARKER_JOBS.stormWatch },
  },
  '/api/cron/tax-harvest': {
    name: 'Tax-loss harvest scan',
    graceHours: WEEKLY_GRACE_HOURS,
    // Marker: a week with no harvestable loss inserts no suggestions.
    evidence: { kind: 'cron_runs', jobName: MARKER_JOBS.taxHarvest },
  },
  '/api/cron/coach-review': {
    name: 'Coach review',
    graceHours: WEEKLY_GRACE_HOURS,
    // Every run delete+inserts the week's row, so created_at is the run time.
    // Deliberately the table and not a marker: persistCoachReview swallows an
    // insert error, and only the missing row reveals that.
    evidence: { kind: 'table', table: 'coach_reviews', column: 'created_at', granularity: 'timestamp' },
  },
  '/api/cron/slo-roundup': {
    name: 'SLO roundup',
    graceHours: WEEKLY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: 'slo-roundup' },
  },
  '/api/cron/migration-drift-check': {
    name: 'Migration drift check',
    graceHours: WEEKLY_GRACE_HOURS,
    evidence: { kind: 'cron_runs', jobName: 'migration-drift-check' },
  },
};

/**
 * The key a cron's evidence is filed under: its registry key when it has one,
 * otherwise `path@schedule` (which, by construction, is not in the registry).
 */
export function cronEvidenceKey(cron: CronScheduleEntry): string {
  const specific = `${cron.path}@${cron.schedule}`;
  if (Object.prototype.hasOwnProperty.call(CRON_REGISTRY, specific)) return specific;
  if (Object.prototype.hasOwnProperty.call(CRON_REGISTRY, cron.path)) return cron.path;
  return specific;
}

export function registryEntryFor(cron: CronScheduleEntry): CronRegistryEntry | null {
  const key = cronEvidenceKey(cron);
  return Object.prototype.hasOwnProperty.call(CRON_REGISTRY, key) ? CRON_REGISTRY[key] : null;
}

// ── Schedule arithmetic ─────────────────────────────────────────────────────

/** Parse one cron field into the set of values it matches, or null if unsupported. */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  if (field.length === 0) return null;
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo: number;
    let hi: number;
    if (m[1] === '*') {
      lo = min;
      hi = max;
    } else if (m[1].includes('-')) {
      const [a, b] = m[1].split('-').map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(m[1]);
      // `5/15` means "from 5, every 15"; a bare number is just itself.
      hi = m[2] === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

const MINUTES_PER_DAY = 24 * 60;
/** Two full weeks, so a once-a-week job is seen twice and its gap is measurable. */
const SCAN_DAYS = 15;

/**
 * Longest gap, in hours, between two consecutive firings of a Vercel cron
 * expression (5 fields, UTC). A weekday-only job therefore reports its
 * Friday→Monday gap, which is what makes weekends tolerated without a
 * special case.
 *
 * Returns null for anything it cannot reason about — wrong field count,
 * unsupported syntax, or a day-of-month / month restriction (no cron here uses
 * one, and their gaps depend on the calendar). Callers must treat null as
 * `unverifiable`, never as "no limit".
 */
export function maxGapHours(schedule: string): number | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = fields;
  if (domF !== '*' || monF !== '*') return null;
  const minutes = parseField(minF, 0, 59);
  const hours = parseField(hourF, 0, 23);
  const dows = parseField(dowF, 0, 6);
  if (!minutes || !hours || !dows) return null;

  // Minute 0 of the scan is a Sunday 00:00, so day index % 7 is the cron
  // day-of-week (0 = Sunday).
  const firings: number[] = [];
  for (let day = 0; day < SCAN_DAYS; day++) {
    if (!dows.has(day % 7)) continue;
    for (let h = 0; h < 24; h++) {
      if (!hours.has(h)) continue;
      for (let mi = 0; mi < 60; mi++) {
        if (minutes.has(mi)) firings.push(day * MINUTES_PER_DAY + h * 60 + mi);
      }
    }
  }
  if (firings.length < 2) return null;
  let maxGap = 0;
  for (let i = 1; i < firings.length; i++) {
    maxGap = Math.max(maxGap, firings[i] - firings[i - 1]);
  }
  return maxGap / 60;
}

// ── Evidence → status ───────────────────────────────────────────────────────

/** A timestamp this far ahead of `now` is not clock skew, it is a bad value. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Epoch ms for an evidence value, or null if it is not a shape we recognise. */
function evidenceToMs(value: string, source: CronEvidenceSource): number | null {
  if (source.kind === 'table' && source.granularity === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Reject 2026-02-31 and friends, which Date.UTC would roll forward.
    return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
  }
  // Require a full ISO date-time; Date.parse alone accepts "2026" and "1".
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Status of every cron in `crons`.
 *
 * @param now      the moment to judge against
 * @param crons    the `crons` array from vercel.json
 * @param evidence latest evidence per `cronEvidenceKey(cron)`: an ISO
 *                 timestamp (or `YYYY-MM-DD` for date columns), `null` when
 *                 the read succeeded and found nothing, and the key ABSENT
 *                 when the read failed. Absent is `unverifiable`, never fresh.
 */
export function evaluateCronFreshness(
  now: Date,
  crons: readonly CronScheduleEntry[],
  evidence: Readonly<Record<string, string | null | undefined>>,
): CronFreshnessRow[] {
  const nowMs = now.getTime();
  return crons.map((cron): CronFreshnessRow => {
    const entry = registryEntryFor(cron);
    const base = { path: cron.path, schedule: cron.schedule };
    if (!entry) {
      return {
        ...base,
        name: cron.path,
        status: 'unverifiable',
        lastEvidenceAt: null,
        maxAgeHours: null,
        detail: 'no entry in CRON_REGISTRY (src/lib/cron-freshness.ts) for this path and schedule',
      };
    }

    const gap = maxGapHours(cron.schedule);
    const maxAgeHours = gap === null ? null : gap + entry.graceHours;
    const named = { ...base, name: entry.name, maxAgeHours };
    if (maxAgeHours === null || !Number.isFinite(nowMs)) {
      return { ...named, status: 'unverifiable', lastEvidenceAt: null, detail: `cannot derive a max age from schedule "${cron.schedule}"` };
    }

    const key = cronEvidenceKey(cron);
    const raw = Object.prototype.hasOwnProperty.call(evidence, key) ? evidence[key] : undefined;
    if (raw === undefined) {
      return { ...named, status: 'unverifiable', lastEvidenceAt: null, detail: 'evidence could not be read' };
    }
    if (raw === null) {
      return { ...named, status: 'never_ran', lastEvidenceAt: null, detail: 'no evidence of any run' };
    }
    if (typeof raw !== 'string') {
      return { ...named, status: 'unverifiable', lastEvidenceAt: null, detail: 'evidence is not a timestamp string' };
    }
    const ms = evidenceToMs(raw, entry.evidence);
    if (ms === null) {
      return { ...named, status: 'unverifiable', lastEvidenceAt: raw, detail: 'evidence is not a parseable timestamp' };
    }
    if (ms - nowMs > FUTURE_TOLERANCE_MS) {
      return { ...named, status: 'unverifiable', lastEvidenceAt: raw, detail: 'evidence is dated in the future' };
    }
    const ageHours = (nowMs - ms) / HOUR_MS;
    if (ageHours > maxAgeHours) {
      return {
        ...named,
        status: 'overdue',
        lastEvidenceAt: raw,
        detail: `last evidence is ${ageHours.toFixed(1)}h old, limit ${maxAgeHours}h`,
      };
    }
    return { ...named, status: 'fresh', lastEvidenceAt: raw };
  });
}
