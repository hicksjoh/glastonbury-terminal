// Cron-route authentication helpers.
//
// The four /api/cron/* routes registered in middleware's PUBLIC_API_ROUTES
// allowlist (storm-watch, tax-harvest, coach-review, prediction-snapshot)
// must self-authenticate. Codex round-2 review caught three regressions
// in the original ad-hoc per-route auth blocks:
//
//   (1) Some routes accepted `req.cookies.get('gt-auth')` as proof of auth
//       without verifying the JWT. A forged `Cookie: gt-auth=garbage`
//       passed the check.
//   (2) The auth block was wrapped in `if (cronSecret) { ... }`, so an
//       empty/unset CRON_SECRET silently dropped the entire check and let
//       unauth requests through. Auth must fail CLOSED.
//   (3) Storm-watch's `?mock=miami` query short-circuited auth entirely.
//
// This module centralizes the fix. `cronIsAuthorized()` always evaluates
// the secret first, returns false if it's missing, and verifies the
// gt-auth cookie as a real signed JWT — never just by presence.

import type { NextRequest } from 'next/server';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';
import { safeSecretEqual } from '@/lib/safe-compare';

export interface CronAuthOptions {
  /** Route name for diagnostic logs when CRON_SECRET is missing. */
  routeName: string;
  /**
   * If true, also accept `x-internal-key: ${INTERNAL_API_KEY}` as a
   * valid auth path. Only enable for routes that historically advertised
   * this header (tax-harvest, coach-review).
   */
  allowInternalKey?: boolean;
}

export async function cronIsAuthorized(
  req: NextRequest,
  opts: CronAuthOptions,
): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      `CRON_SECRET not set — refusing all requests on ${opts.routeName}`,
    );
    return false;
  }

  // Constant-time compare so an attacker can't statistically recover
  // CRON_SECRET / INTERNAL_API_KEY by timing many probe requests.
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    if (safeSecretEqual(authHeader.slice(7), cronSecret)) return true;
  }
  if (safeSecretEqual(req.headers.get('x-api-key'), cronSecret)) return true;

  if (opts.allowInternalKey) {
    const expectedInternal = process.env.INTERNAL_API_KEY;
    if (expectedInternal && safeSecretEqual(req.headers.get('x-internal-key'), expectedInternal)) {
      return true;
    }
  }

  // gt-auth cookie path — must be a valid signed JWT, not just present.
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value) {
    const payload = await verifySessionJwt(cookie.value);
    if (payload) return true;
  }

  return false;
}
