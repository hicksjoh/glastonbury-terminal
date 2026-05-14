import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

/**
 * Codex round-3 P1 — durable rate-limit migration coverage.
 *
 * These 7 routes were still importing the in-memory `rateLimit()` from
 * `@/lib/rate-limit` after p0-6 + p1-6 should have caught them. The
 * in-memory limiter lives in a module-level Map and forks per Vercel
 * instance, so under sustained load the effective cap = declared × N
 * warm workers. For Anthropic/Alpaca-billing routes that's a real
 * wallet risk.
 *
 * This test is a tripwire — if anyone re-introduces the in-memory
 * limiter to one of these routes the suite goes red.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

const ROUTES_REQUIRING_DURABLE_LIMIT = [
  'src/app/api/alpaca/orders/route.ts',
  'src/app/api/options/order/route.ts',
  'src/app/api/options/order/multi-leg/route.ts',
  'src/app/api/autopilot/route.ts',
  'src/app/api/optimize/route.ts',
  'src/app/api/earnings-tone/route.ts',
  'src/app/api/earnings/live/session/[id]/end/route.ts',
] as const;

describe('durable rate-limit migration coverage', () => {
  for (const rel of ROUTES_REQUIRING_DURABLE_LIMIT) {
    it(`${rel} imports checkRateLimitDurable, not the in-memory rateLimit`, async () => {
      const src = await readFile(resolve(REPO_ROOT, rel), 'utf8');

      // Must use the durable helper.
      expect(src).toMatch(/from\s+['"]@\/lib\/rate-limit-durable['"]/);
      expect(src).toMatch(/checkRateLimitDurable/);

      // Must NOT import the in-memory legacy. We allow the durable module
      // itself to fall back to it as a last resort, but not these routes.
      expect(src).not.toMatch(/from\s+['"]@\/lib\/rate-limit['"]/);
    });
  }
});
