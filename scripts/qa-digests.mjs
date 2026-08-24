#!/usr/bin/env node
/**
 * Digest / cron QA harness.
 *
 * Three modes, safest first:
 *
 *   node scripts/qa-digests.mjs                 # audit  — static, no network
 *   node scripts/qa-digests.mjs --probe         # probe  — live, NO side effects
 *   node scripts/qa-digests.mjs --dry-run       # live, dry-run-capable crons only
 *
 * audit    Parses vercel.json, resolves each cron to its route file, and
 *          reports the next few fire times in UTC *and* ET. Vercel evaluates
 *          cron expressions in UTC only, so the ET column is where DST drift
 *          shows up: every schedule here lands an hour earlier from Nov–Mar.
 *
 * probe    GETs each cron path on the live host with a deliberately WRONG
 *          bearer token. A healthy cron answers 401 (route deployed,
 *          middleware allowlisted it, handler self-authenticates). A 404
 *          means the route isn't deployed; a 200 means the route is NOT
 *          authenticating and anyone can fire it. No side effects either way.
 *
 * dry-run  Fires `?mode=dry-run` against the crons that support it, using the
 *          real CRON_SECRET. These compose the digest and return a preview
 *          without sending email or burning the week's idempotency slot.
 *
 * Env: CRON_SECRET (probe/dry-run), QA_BASE_URL (default: production).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.QA_BASE_URL ?? 'https://terminal.johnwesleyhicks.com').replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET ?? '';

const mode = process.argv.includes('--dry-run')
  ? 'dry-run'
  : process.argv.includes('--probe')
    ? 'probe'
    : 'audit';

const { crons } = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const ok = s => `${c.green}${s}${c.reset}`;
const bad = s => `${c.red}${s}${c.reset}`;
const warn = s => `${c.yellow}${s}${c.reset}`;

// ── Minimal cron matcher (5-field, UTC) ───────────────────────────────────
function fieldMatches(spec, value) {
  for (const part of spec.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    let lo, hi;
    if (range === '*') { lo = -Infinity; hi = Infinity; }
    else if (range.includes('-')) { const [a, b] = range.split('-').map(Number); lo = a; hi = b; }
    else { lo = hi = Number(range); }

    if (range === '*') {
      if (step === 1 || value % step === 0) return true;
      continue;
    }
    if (value < lo || value > hi) continue;
    if ((value - lo) % step === 0) return true;
  }
  return false;
}

function matches(schedule, d) {
  const [min, hr, dom, mon, dow] = schedule.trim().split(/\s+/);
  return (
    fieldMatches(min, d.getUTCMinutes()) &&
    fieldMatches(hr, d.getUTCHours()) &&
    fieldMatches(dom, d.getUTCDate()) &&
    fieldMatches(mon, d.getUTCMonth() + 1) &&
    fieldMatches(dow, d.getUTCDay())
  );
}

function nextFires(schedule, count = 3, horizonDays = 40) {
  const out = [];
  const d = new Date();
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  const limit = horizonDays * 24 * 60;
  for (let i = 0; i < limit && out.length < count; i++) {
    if (matches(schedule, d)) out.push(new Date(d));
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return out;
}

const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});
const utcFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

function routeSource(cronPath) {
  const f = path.join(ROOT, 'src/app', cronPath, 'route.ts');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

// ── audit ─────────────────────────────────────────────────────────────────
function audit() {
  console.log(`${c.bold}Cron audit — ${crons.length} scheduled jobs${c.reset}`);
  console.log(`${c.dim}Vercel evaluates all schedules in UTC. The ET column is the real${c.reset}`);
  console.log(`${c.dim}delivery time and shifts by an hour across DST boundaries.${c.reset}\n`);

  let problems = 0;

  for (const cron of crons) {
    const src = routeSource(cron.path);
    const fires = nextFires(cron.schedule);
    console.log(`${c.bold}${cron.path}${c.reset}  ${c.cyan}${cron.schedule}${c.reset}`);

    if (!src) {
      console.log(`  ${bad('MISSING')} no route file at src/app${cron.path}/route.ts`);
      problems++;
    } else {
      const hasGet = /export\s+(const\s+GET\s*=|async\s+function\s+GET\b|function\s+GET\b)/.test(src);
      const hasAuth = /cronIsAuthorized/.test(src);
      const hasPing = /pingHealthcheck/.test(src);
      const hasClaim = /tryClaimCronRun/.test(src);
      const hasDry = /mode'\s*\)\s*===\s*'dry-run'|'dry-run'/.test(src);
      const sends = /sendResendEmail\s*\(/.test(src);
      const pushes = /sendPushNotification\s*\(/.test(src);

      if (!hasGet) { console.log(`  ${bad('NO GET')} Vercel cron dispatches GET — this route cannot fire`); problems++; }
      if (!hasAuth) { console.log(`  ${bad('NO CRON AUTH')} handler never calls cronIsAuthorized()`); problems++; }
      if (!hasPing) { console.log(`  ${warn('NO DEADMAN')} no Healthchecks ping — a silent stop is undetectable`); problems++; }
      if ((sends || pushes) && !hasClaim) {
        console.log(`  ${warn('NO IDEMPOTENCY')} fans out ${sends ? 'email' : 'push'} without a cron_runs claim`);
        problems++;
      }

      const tags = [
        hasClaim ? ok('idempotent') : c.dim + 'no-claim' + c.reset,
        hasDry ? ok('dry-run') : c.dim + 'no-dry-run' + c.reset,
        sends ? 'email' : null,
        pushes ? 'push' : null,
      ].filter(Boolean).join(' · ');
      console.log(`  ${c.dim}${tags}${c.reset}`);
    }

    for (const f of fires) {
      console.log(`  ${c.dim}next${c.reset} ${utcFmt.format(f)} UTC   ${c.dim}→${c.reset} ${etFmt.format(f)}`);
    }
    console.log();
  }

  // DST drift: compare the ET hour of the next fire vs one six months out.
  console.log(`${c.bold}DST drift${c.reset}`);
  const etHour = d => Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).format(d)) % 24;
  for (const cron of crons) {
    const soon = nextFires(cron.schedule, 1)[0];
    const later = nextFires(cron.schedule, 1, 400).length
      ? nextFires(cron.schedule, 200, 400).find(d => etHour(d) !== etHour(soon))
      : null;
    if (soon && later) {
      console.log(`  ${cron.path}: ${etHour(soon)}:xx ET now → ${warn(`${etHour(later)}:xx ET`)} after the next DST change`);
    }
  }
  console.log(`\n${problems === 0 ? ok('No static problems found.') : bad(`${problems} problem(s) found.`)}`);
  return problems === 0 ? 0 : 1;
}

// ── probe (live, no side effects) ─────────────────────────────────────────
async function probe() {
  console.log(`${c.bold}Live auth probe — ${BASE}${c.reset}`);
  console.log(`${c.dim}Sends a deliberately wrong bearer token. Expect 401 everywhere.${c.reset}\n`);

  let problems = 0;
  for (const cron of crons) {
    const url = `${BASE}${cron.path}`;
    let status, note = '';
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer qa-probe-deliberately-invalid' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
    } catch (err) {
      console.log(`  ${bad('ERROR')} ${cron.path} — ${err.message}`);
      problems++;
      continue;
    }

    let verdict;
    if (status === 401) verdict = ok('401 OK');
    else if (status === 404) { verdict = bad('404 NOT DEPLOYED'); problems++; }
    else if (status === 200) { verdict = bad('200 UNAUTHENTICATED'); problems++; note = ' — route fires for anyone'; }
    else if (status === 500) { verdict = warn('500'); note = ' — CRON_SECRET may be unset (fails closed)'; problems++; }
    else { verdict = warn(String(status)); problems++; }

    console.log(`  ${verdict} ${cron.path}${note}`);
  }
  console.log(`\n${problems === 0 ? ok('All crons reachable and authenticating.') : bad(`${problems} problem(s).`)}`);
  return problems === 0 ? 0 : 1;
}

// ── dry-run (live, composes digests without sending) ──────────────────────
async function dryRun() {
  if (!SECRET) {
    console.error(bad('CRON_SECRET is not set — cannot dry-run.'));
    return 1;
  }
  const capable = crons.filter(cron => {
    const src = routeSource(cron.path);
    return src && /'dry-run'/.test(src);
  });

  console.log(`${c.bold}Dry-run — ${capable.length} of ${crons.length} crons support ?mode=dry-run${c.reset}`);
  console.log(`${c.dim}Composes each digest and returns a preview. No email is sent and no${c.reset}`);
  console.log(`${c.dim}idempotency slot is consumed.${c.reset}\n`);

  let problems = 0;
  for (const cron of capable) {
    const url = `${BASE}${cron.path}?mode=dry-run`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SECRET}` },
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log(`  ${bad(String(res.status))} ${cron.path} — ${body.error ?? 'no body'}`);
        problems++;
        continue;
      }
      console.log(`  ${ok('200')} ${cron.path}`);
      if (body.subject) console.log(`      subject: ${body.subject}`);
      if (body.textPreview) {
        console.log(`      ${c.dim}${body.textPreview.split('\n').slice(0, 4).join('\n      ')}${c.reset}`);
      }
    } catch (err) {
      console.log(`  ${bad('ERROR')} ${cron.path} — ${err.message}`);
      problems++;
    }
  }

  const skipped = crons.filter(x => !capable.includes(x));
  if (skipped.length) {
    console.log(`\n${c.dim}No dry-run support (would have real side effects, not fired):${c.reset}`);
    for (const s of skipped) console.log(`  ${c.dim}· ${s.path}${c.reset}`);
  }
  console.log(`\n${problems === 0 ? ok('All dry-runs composed cleanly.') : bad(`${problems} problem(s).`)}`);
  return problems === 0 ? 0 : 1;
}

const exit = mode === 'probe' ? await probe() : mode === 'dry-run' ? await dryRun() : audit();
process.exit(exit);
