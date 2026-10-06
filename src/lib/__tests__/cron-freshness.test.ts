import { describe, it, expect } from 'vitest';
import vercelConfig from '../../../vercel.json';
import {
  CRON_REGISTRY,
  NARRATIVE_SCHEDULES,
  cronEvidenceKey,
  evaluateCronFreshness,
  isHealthyCronStatus,
  maxGapHours,
  registryEntryFor,
  type CronScheduleEntry,
} from '../cron-freshness';

// Armed long ago, so these cases exercise the steady-state verdicts. The
// arming window itself is covered in its own describe below.
const LONG_ARMED = '2026-01-01T00:00:00Z';
const at = (iso: string) => new Date(iso);
const hoursBefore = (iso: string, h: number) => new Date(at(iso).getTime() - h * 3_600_000).toISOString();

/** One-cron helper: status of `cron` given a single evidence value. */
function statusOf(cron: CronScheduleEntry, now: string, value: string | null | undefined) {
  const evidence = value === undefined ? {} : { [cronEvidenceKey(cron)]: value };
  return evaluateCronFreshness(at(now), [cron], evidence, LONG_ARMED)[0];
}

const STORM: CronScheduleEntry = { path: '/api/cron/storm-watch', schedule: '0 12 * * *' };
const MORNING: CronScheduleEntry = { path: '/api/briefing/morning-push', schedule: '30 10 * * 1-5' };
const PORTFOLIO: CronScheduleEntry = { path: '/api/portfolio/snapshot', schedule: '0 22 * * 1-5' };
const WEEKLY: CronScheduleEntry = { path: '/api/cron/weekly-report', schedule: '0 23 * * 0' };

describe('maxGapHours', () => {
  it('is 24h for a daily job', () => {
    expect(maxGapHours('0 12 * * *')).toBe(24);
  });
  it('is the Friday→Monday gap (72h) for a weekday-only job', () => {
    expect(maxGapHours('30 10 * * 1-5')).toBe(72);
    expect(maxGapHours('0 22 * * 1-5')).toBe(72);
  });
  it('is 168h for a weekly job', () => {
    expect(maxGapHours('0 23 * * 0')).toBe(168);
    expect(maxGapHours('0 21 * * 5')).toBe(168);
  });
  it('handles lists and steps', () => {
    expect(maxGapHours('0 */6 * * *')).toBe(6);
    expect(maxGapHours('0 9 * * 1,4')).toBe(96); // Thu→Mon
  });
  it('returns null (never "no limit") for shapes it cannot reason about', () => {
    for (const bad of [
      '',
      'not a cron',
      '0 12 * *',            // 4 fields
      '0 12 * * * *',        // 6 fields
      '0 12 1 * *',          // day-of-month restriction
      '0 12 * 6 *',          // month restriction
      '0 12 * * MON',        // names
      '0 12 * * 7',          // out of range
      '61 12 * * *',
      '0 25 * * *',
      '0 12 * * 5-1',        // inverted range
      '*/0 * * * *',
      '@daily',
    ]) {
      expect(maxGapHours(bad), bad).toBeNull();
    }
  });
});

describe('evaluateCronFreshness', () => {
  it('FAILS CLOSED: a cron path with no registry entry is unverifiable, even with fresh-looking evidence', () => {
    const madeUp: CronScheduleEntry = { path: '/api/cron/definitely-not-registered', schedule: '0 12 * * *' };
    const now = '2026-10-07T11:00:00Z';
    const [row] = evaluateCronFreshness(at(now), [madeUp], {
      [cronEvidenceKey(madeUp)]: hoursBefore(now, 1),
      [madeUp.path]: hoursBefore(now, 1),
    }, LONG_ARMED);
    expect(row.status).toBe('unverifiable');
    expect(row.maxAgeHours).toBeNull();
    expect(row.detail).toMatch(/CRON_REGISTRY/);
  });

  it('FAILS CLOSED: a new schedule on the multi-job prediction-snapshot path is unverifiable', () => {
    const extra: CronScheduleEntry = { path: '/api/cron/prediction-snapshot', schedule: '0 20 * * *' };
    expect(registryEntryFor(extra)).toBeNull();
    expect(statusOf(extra, '2026-10-07T11:00:00Z', '2026-10-07T10:00:00Z').status).toBe('unverifiable');
  });

  it('FAILS CLOSED: a registered cron whose schedule cannot be parsed is unverifiable', () => {
    const odd: CronScheduleEntry = { path: STORM.path, schedule: '0 12 1 * *' };
    const row = statusOf(odd, '2026-10-07T11:00:00Z', '2026-10-07T10:00:00Z');
    expect(row.status).toBe('unverifiable');
    expect(row.maxAgeHours).toBeNull();
  });

  it('FAILS CLOSED: evidence that could not be read (key absent) is unverifiable, not fresh and not never_ran', () => {
    expect(statusOf(STORM, '2026-10-07T11:00:00Z', undefined).status).toBe('unverifiable');
  });

  it('FAILS CLOSED: garbage, non-string and future evidence are unverifiable', () => {
    const now = '2026-10-07T11:00:00Z';
    for (const bad of ['', 'yesterday', '2026', '1', '2026-10-07', 'null']) {
      expect(statusOf(STORM, now, bad).status, JSON.stringify(bad)).toBe('unverifiable');
    }
    expect(statusOf(STORM, now, 1759834800000 as unknown as string).status).toBe('unverifiable');
    expect(statusOf(STORM, now, '2026-10-08T11:00:00Z').status).toBe('unverifiable');
    // date-granularity column: a timestamp or an impossible date is the wrong shape
    expect(statusOf(PORTFOLIO, now, '2026-10-06T22:00:00Z').status).toBe('unverifiable');
    expect(statusOf(PORTFOLIO, now, '2026-02-31').status).toBe('unverifiable');
  });

  it('tolerates small clock skew on a just-written row', () => {
    expect(statusOf(STORM, '2026-10-07T12:00:00Z', '2026-10-07T12:00:30Z').status).toBe('fresh');
  });

  it('reports never_ran when the read succeeded and found nothing', () => {
    const row = statusOf(STORM, '2026-10-07T11:00:00Z', null);
    expect(row.status).toBe('never_ran');
    expect(row.lastEvidenceAt).toBeNull();
  });

  it('daily job: fresh inside 24h + grace, overdue past it', () => {
    const now = '2026-10-07T11:00:00Z';
    const fresh = statusOf(STORM, now, hoursBefore(now, 23));
    expect(fresh.status).toBe('fresh');
    expect(fresh.maxAgeHours).toBe(27);
    expect(fresh.detail).toBeUndefined();
    expect(statusOf(STORM, now, hoursBefore(now, 26.9)).status).toBe('fresh');
    const late = statusOf(STORM, now, hoursBefore(now, 27.1));
    expect(late.status).toBe('overdue');
    expect(late.detail).toMatch(/limit 27h/);
  });

  describe('weekend tolerance for weekday-only jobs', () => {
    // 2026-10-09 is a Friday. Morning push last completed Fri 10:30 UTC.
    const fridayRun = '2026-10-09T10:30:40Z';
    it('is fresh at the Saturday, Sunday and Monday 11:00 UTC nightly runs', () => {
      expect(statusOf(MORNING, '2026-10-10T11:00:00Z', fridayRun).status).toBe('fresh');
      expect(statusOf(MORNING, '2026-10-11T11:00:00Z', fridayRun).status).toBe('fresh');
      expect(statusOf(MORNING, '2026-10-12T11:00:00Z', fridayRun).status).toBe('fresh');
    });
    it('is overdue by Tuesday if Monday never ran', () => {
      expect(statusOf(MORNING, '2026-10-13T11:00:00Z', fridayRun).status).toBe('overdue');
    });
    it('a missed Friday is caught over the weekend, not hidden by it', () => {
      const thursdayRun = '2026-10-08T10:30:40Z';
      expect(statusOf(MORNING, '2026-10-10T11:00:00Z', thursdayRun).status).toBe('fresh'); // 48.5h < 75h
      expect(statusOf(MORNING, '2026-10-11T11:00:00Z', thursdayRun).status).toBe('fresh'); // 72.5h < 75h
      expect(statusOf(MORNING, '2026-10-12T11:00:00Z', thursdayRun).status).toBe('overdue'); // 96.5h
    });
  });

  describe('date-granularity evidence (portfolio_snapshots.date)', () => {
    it('Friday\'s row is fresh through Monday morning', () => {
      expect(statusOf(PORTFOLIO, '2026-10-10T11:00:00Z', '2026-10-09').status).toBe('fresh');
      expect(statusOf(PORTFOLIO, '2026-10-12T11:00:00Z', '2026-10-09').status).toBe('fresh');
    });
    it('is overdue Tuesday morning when Monday wrote nothing', () => {
      expect(statusOf(PORTFOLIO, '2026-10-13T11:00:00Z', '2026-10-09').status).toBe('overdue');
    });
    it('the months-dead snapshot cron that motivated this check reads as overdue / never_ran', () => {
      expect(statusOf(PORTFOLIO, '2026-10-05T11:00:00Z', '2026-06-12').status).toBe('overdue');
      expect(statusOf(PORTFOLIO, '2026-10-05T11:00:00Z', null).status).toBe('never_ran');
    });
  });

  it('weekly job: tolerates ~8 days, not more', () => {
    const sundayRun = '2026-10-04T23:00:20Z';
    const row = statusOf(WEEKLY, '2026-10-11T11:00:00Z', sundayRun);
    expect(row.status).toBe('fresh');
    expect(row.maxAgeHours).toBe(192);
    expect(statusOf(WEEKLY, '2026-10-12T11:00:00Z', sundayRun).status).toBe('fresh');   // 7d12h
    expect(statusOf(WEEKLY, '2026-10-13T11:00:00Z', sundayRun).status).toBe('overdue'); // 8d12h
  });

  it('the two narrative schedules and the snapshot schedule on one path use separate evidence', () => {
    const crons: CronScheduleEntry[] = [
      { path: '/api/cron/prediction-snapshot', schedule: NARRATIVE_SCHEDULES[0] },
      { path: '/api/cron/prediction-snapshot', schedule: NARRATIVE_SCHEDULES[1] },
      { path: '/api/cron/prediction-snapshot', schedule: '0 13 * * *' },
    ];
    const keys = crons.map(cronEvidenceKey);
    expect(new Set(keys).size).toBe(3);
    const now = '2026-10-07T19:00:00Z';
    const rows = evaluateCronFreshness(at(now), crons, {
      [keys[0]]: hoursBefore(now, 5),
      [keys[1]]: null,
      // keys[2] absent → read failed
    }, LONG_ARMED);
    expect(rows.map(r => r.status)).toEqual(['fresh', 'never_ran', 'unverifiable']);
  });

  it('returns one row per input cron, in order, and never drops one', () => {
    const crons: CronScheduleEntry[] = [STORM, { path: '/x', schedule: 'junk' }, WEEKLY];
    const rows = evaluateCronFreshness(at('2026-10-07T11:00:00Z'), crons, {}, LONG_ARMED);
    expect(rows.map(r => r.path)).toEqual(crons.map(c => c.path));
    expect(rows.every(r => r.status === 'unverifiable')).toBe(true);
  });
});

describe('registry ↔ vercel.json', () => {
  const crons = vercelConfig.crons as CronScheduleEntry[];

  it('every cron in vercel.json has a registry entry and a derivable max age', () => {
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) {
      const label = `${cron.path} @ ${cron.schedule}`;
      expect(registryEntryFor(cron), `${label} — add it to CRON_REGISTRY`).not.toBeNull();
      expect(maxGapHours(cron.schedule), label).not.toBeNull();
    }
  });

  it('every registry entry is still scheduled (no dead entries masking a removed cron)', () => {
    const scheduled = new Set(crons.map(cronEvidenceKey));
    for (const key of Object.keys(CRON_REGISTRY)) {
      expect(scheduled.has(key), `${key} is in CRON_REGISTRY but not in vercel.json`).toBe(true);
    }
  });

  it('with fresh evidence for every key, the real cron list is all fresh on any day of the week', () => {
    // Evidence = each cron's most recent scheduled firing before `now`, found
    // by walking back minute by minute. Proves the derived limits never flag a
    // healthy system, weekends included (portfolio uses its date column).
    for (let day = 5; day <= 18; day++) {
      const now = new Date(Date.UTC(2026, 9, day, 11, 0, 0));
      const evidence: Record<string, string> = {};
      for (const cron of crons) {
        const [minF, hourF, , , dowF] = cron.schedule.split(' ');
        const dows = dowF === '*' ? null : dowF.includes('-')
          ? (() => { const [a, b] = dowF.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); })()
          : [Number(dowF)];
        const t = new Date(now);
        t.setUTCSeconds(0, 0);
        for (let i = 0; i < 9 * 24 * 60; i++) {
          if (t.getUTCMinutes() === Number(minF) && t.getUTCHours() === Number(hourF) && (!dows || dows.includes(t.getUTCDay()))) break;
          t.setTime(t.getTime() - 60_000);
        }
        const entry = registryEntryFor(cron)!;
        evidence[cronEvidenceKey(cron)] =
          entry.evidence.kind === 'table' && entry.evidence.granularity === 'date'
            ? t.toISOString().slice(0, 10)
            : new Date(t.getTime() + 45_000).toISOString();
      }
      const rows = evaluateCronFreshness(now, crons, evidence, LONG_ARMED);
      const bad = rows.filter(r => r.status !== 'fresh').map(r => `${r.path} ${r.schedule}: ${r.status} ${r.detail}`);
      expect(bad, now.toISOString()).toEqual([]);
    }
  });
});

describe('arming window: day one is not an alarm, and it expires', () => {
  const snapshot = { path: '/api/portfolio/snapshot', schedule: '0 22 * * 1-5' };
  const storm = { path: '/api/cron/storm-watch', schedule: '0 12 * * *' };
  const armed = '2026-10-06T12:00:00Z';

  it('a job with no evidence is awaiting_first_run inside its first window', () => {
    const [row] = evaluateCronFreshness(at('2026-10-06T20:00:00Z'), [snapshot], { [snapshot.path]: null }, armed);
    expect(row.status).toBe('awaiting_first_run');
    expect(isHealthyCronStatus(row.status)).toBe(true);
  });

  it('stale pre-arming evidence is also awaiting, not overdue (storm-watch last marked in August)', () => {
    const [row] = evaluateCronFreshness(
      at('2026-10-06T20:00:00Z'), [storm], { [storm.path]: '2026-08-02T12:50:50Z' }, armed,
    );
    expect(row.status).toBe('awaiting_first_run');
    expect(row.lastEvidenceAt).toBe('2026-08-02T12:50:50Z');
  });

  it('once the window passes, the same states alarm for good', () => {
    // Daily job: 24h gap + 3h grace = 27h after arming.
    const late = at('2026-10-07T16:00:00Z');
    expect(evaluateCronFreshness(late, [storm], { [storm.path]: null }, armed)[0].status).toBe('never_ran');
    expect(
      evaluateCronFreshness(late, [storm], { [storm.path]: '2026-08-02T12:50:50Z' }, armed)[0].status,
    ).toBe('overdue');
  });

  it('never softens unverifiable: a failed read alarms even on day one', () => {
    const [row] = evaluateCronFreshness(at('2026-10-06T20:00:00Z'), [storm], {}, armed);
    expect(row.status).toBe('unverifiable');
    expect(isHealthyCronStatus(row.status)).toBe(false);
  });

  it('an unparseable arming date arms nothing', () => {
    const [row] = evaluateCronFreshness(at('2026-10-06T20:00:00Z'), [storm], { [storm.path]: null }, 'not-a-date');
    expect(row.status).toBe('never_ran');
  });
});
