// Constant-time secret comparison.
//
// `===` on a server secret leaks the position of the first differing byte
// via timing. Negligible on a single request, but cron / OAuth / MCP get
// probed by automated clients that can statistically extract a secret over
// thousands of requests. `crypto.timingSafeEqual` does the comparison in
// fixed time relative to length — combined with the early-return on length
// mismatch (which leaks length, not value) this is the standard pattern.
//
// Existing call sites that should use this (replacing direct ===):
//   - middleware.ts                        — INTERNAL_API_KEY check
//   - src/lib/cron-auth.ts                 — CRON_SECRET / x-api-key / INTERNAL_API_KEY
//   - src/app/api/mcp/route.ts             — MCP_AUTH_TOKEN bearer + x-api-key
//
// Login already uses an inline copy of this; kept there to avoid coupling
// the auth route to a lib import on the hot path.

import { timingSafeEqual } from 'crypto';

/**
 * Compare two secret strings in constant time.
 * Returns false if either side is missing or lengths differ.
 */
export function safeSecretEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
