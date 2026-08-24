import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cron delivery-contract QA gate.
 *
 * Motivation: "my digests don't fire regularly." Every failure mode below
 * is silent in production — the route 401s, no-ops, or drops an unawaited
 * promise, and nothing pages because the Healthchecks ping that would have
 * gone red is inside the branch that never runs.
 *
 * These are static assertions over vercel.json + the route sources. They
 * are cheap, they run in CI, and each one corresponds to a real defect
 * found during the 2026-08 digest QA pass.
 */

const ROOT = path.resolve(__dirname, '../../..');

type CronEntry = { path: string; schedule: string };

const crons: CronEntry[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'),
).crons;

/** Map a vercel.json cron path to its App Router route file. */
function routeFileFor(cronPath: string): string {
  return path.join(ROOT, 'src/app', cronPath, 'route.ts');
}

function readRoute(cronPath: string): string {
  return fs.readFileSync(routeFileFor(cronPath), 'utf8');
}

/**
 * Drop // and block comments so the assertions below match real code and
 * not the prose describing the bug they guard against.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('cron contract — vercel.json is wired to real routes', () => {
  it('declares at least one cron', () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons)('$path has a route file', ({ path: p }) => {
    expect(fs.existsSync(routeFileFor(p))).toBe(true);
  });

  it.each(crons)('$path uses a valid 5-field cron expression', ({ schedule }) => {
    const fields = schedule.trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    // Vercel evaluates schedules in UTC with no timezone support.
    expect(schedule).not.toMatch(/TZ=|CRON_TZ=/);
  });

  it('has no duplicate cron paths', () => {
    const paths = crons.map(c => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * Resolve the source text of the function that actually serves GET.
 *
 * App Router routes in this repo use two shapes:
 *   export const GET = handle;              // alias to a shared handler
 *   export async function GET(req) { ... }  // direct declaration
 *
 * We resolve the alias, then brace-match the target function body. This is
 * what lets the test see that /api/portfolio/snapshot's GET was the
 * session-gated *read* path while the snapshot work lived only in POST.
 */
function functionBody(src: string, name: string): string | null {
  const declRe = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
  );
  const m = declRe.exec(src);
  if (!m) return null;

  const open = src.indexOf('{', m.index + m[0].length - 1);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Source text reachable from GET: the handler body plus the bodies of any
 * locally-declared functions it calls, transitively. Routes split the cron
 * work across helpers (`handle`, `takeSnapshot`, `runScheduledBriefing`),
 * so a shallow read of GET alone would miss the ping and the auth call.
 */
function getHandlerBody(src: string, depth = 4): string | null {
  const alias = /export\s+const\s+GET\s*=\s*([A-Za-z_$][\w$]*)/.exec(src);
  const root = functionBody(src, alias ? alias[1] : 'GET');
  if (root === null) return null;

  const seen = new Set<string>([alias ? alias[1] : 'GET']);
  let combined = root;
  let frontier = [root];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const body of frontier) {
      const callRe = /([A-Za-z_$][\w$]*)\s*\(/g;
      let call: RegExpExecArray | null;
      while ((call = callRe.exec(body)) !== null) {
        const name = call[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const nested = functionBody(src, name);
        if (nested) {
          combined += '\n' + nested;
          next.push(nested);
        }
      }
    }
    frontier = next;
  }

  return combined;
}

describe('cron contract — GET is the only verb Vercel dispatches', () => {
  /**
   * REGRESSION (D1): /api/portfolio/snapshot was registered as a cron but
   * only its POST handler took the snapshot. Vercel cron sends GET, which
   * hit the session-gated read path and returned 401 on every weekday fire.
   * The snapshot cron had never once run, and because pingHealthcheck() was
   * only reachable from POST, the deadman check was never even created — so
   * nothing alerted.
   */
  it.each(crons)('$path exports a GET handler', ({ path: p }) => {
    const src = readRoute(p);
    const exportsGet =
      /export\s+const\s+GET\s*=/.test(src) ||
      /export\s+async\s+function\s+GET\b/.test(src) ||
      /export\s+function\s+GET\b/.test(src);
    expect(exportsGet).toBe(true);
  });

  it.each(crons)('$path GET handler body is resolvable', ({ path: p }) => {
    expect(getHandlerBody(stripComments(readRoute(p)))).not.toBeNull();
  });

  it.each(crons)('$path authenticates the GET request as a cron', ({ path: p }) => {
    // Cron auth must be reachable from GET specifically. A route that only
    // calls cronIsAuthorized() inside POST cannot be driven by Vercel cron.
    expect(getHandlerBody(stripComments(readRoute(p)))).toMatch(/cronIsAuthorized/);
  });

  it.each(crons)('$path GET handler does the work (pings Healthchecks)', ({ path: p }) => {
    // If the deadman ping is unreachable from GET, a cron that never fires
    // looks identical to a cron that fires fine — the check is never created.
    expect(getHandlerBody(stripComments(readRoute(p)))).toMatch(/pingHealthcheck/);
  });
});

describe('cron contract — every cron is reachable through middleware', () => {
  const middleware = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8');

  /**
   * Vercel cron requests carry Authorization: Bearer <CRON_SECRET>, not a
   * gt-auth session cookie. If the path is not on the middleware allowlist
   * the request dies at the edge with 401 before the route's own
   * cronIsAuthorized() ever runs.
   */
  it.each(crons)('$path is allowlisted in middleware PUBLIC_ROUTES', ({ path: p }) => {
    expect(middleware).toContain(`path: '${p}'`);
  });
});

describe('cron contract — every cron is observable', () => {
  it.each(crons)('$path pings Healthchecks on start, success and fail', ({ path: p }) => {
    const src = readRoute(p);
    expect(src).toMatch(/pingHealthcheck\(\s*HC_SLUG\s*,\s*'start'\s*\)/);
    expect(src).toMatch(/pingHealthcheck\(\s*HC_SLUG\s*,\s*'success'\s*\)/);
    expect(src).toMatch(/pingHealthcheck\(\s*HC_SLUG\s*,\s*'fail'\s*\)/);
  });
});

describe('cron contract — fan-out side effects are not fire-and-forget', () => {
  /**
   * REGRESSION (D2): coach-review and tax-harvest called
   *   sendResendEmail({...}).catch(() => {})
   * without awaiting. On Vercel the function instance can be frozen the
   * instant the response is returned, so the in-flight POST to Resend is
   * killed non-deterministically — the digest arrives some weeks and not
   * others. The .catch(() => {}) also swallowed every delivery failure:
   * no log, no Sentry event, no Healthchecks 'fail'.
   */
  const emailCrons = crons.filter(c => /sendResendEmail\s*\(/.test(stripComments(readRoute(c.path))));

  it('finds the email-sending crons', () => {
    expect(emailCrons.length).toBeGreaterThan(0);
  });

  it.each(emailCrons)('$path awaits every sendResendEmail call', ({ path: p }) => {
    const src = stripComments(readRoute(p));
    const callSites = src.match(/sendResendEmail\s*\(/g) ?? [];
    const awaited = src.match(/await\s+sendResendEmail\s*\(/g) ?? [];
    expect(callSites.length).toBeGreaterThan(0);
    expect(awaited.length).toBe(callSites.length);
  });

  it.each(emailCrons)('$path surfaces a failed send instead of swallowing it', ({ path: p }) => {
    const src = stripComments(readRoute(p));
    // A delivery failure must go red on the deadman check, not vanish into
    // an empty .catch(). Guards the D2 regression from the other side.
    expect(src).not.toMatch(/sendResendEmail[\s\S]{0,400}?\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
    expect(src).toMatch(/sendResult\.ok/);
  });

  it.each(emailCrons)('$path claims a cron_runs slot before emailing', ({ path: p }) => {
    // Without an idempotency claim, a duplicate fire re-sends the digest —
    // and for coach-review, re-runs a full Opus call.
    // Either helper is fine: claimCronRun() or the tryClaimCronRun() wrapper.
    expect(stripComments(readRoute(p))).toMatch(/\b(?:try)?[Cc]laimCronRun\s*\(/);
  });

  /**
   * REGRESSION (D4): a fail-closed claim returns false BOTH when the digest
   * already ran and when the claim RPC itself is broken — e.g.
   * 20260506_cron_run_idempotency.sql was never applied to the project. The
   * routes collapsed both into `{ ok: true, skipped: '...' }`, so a digest
   * that had silently never sent looked exactly like one that correctly
   * deduped. A fail-closed cron must distinguish the two.
   */
  const failClosed = emailCrons.filter(cron =>
    /onRpcError:\s*'closed'/.test(stripComments(readRoute(cron.path))),
  );

  it('finds the fail-closed email crons', () => {
    expect(failClosed.length).toBeGreaterThan(0);
  });

  it.each(failClosed)('$path reports a broken claim RPC instead of a clean skip', ({ path: p }) => {
    const src = stripComments(readRoute(p));
    expect(src).toMatch(/reason\s*===\s*'rpc_error'/);
    // And it must go red on the deadman check rather than returning 200.
    expect(src).toMatch(/rpc_error'[\s\S]{0,400}?pingHealthcheck\(\s*HC_SLUG\s*,\s*'fail'\s*\)/);
  });
});
