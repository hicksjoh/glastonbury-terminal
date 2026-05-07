// Request-ID extraction / generation.
//
// Every API handler should derive a request_id once at the top, bind it to
// a child logger via childLogger({ request_id, ... }), and propagate it
// downstream. This makes it possible to grep every log line emitted during
// a single request out of the JSON drain.
//
// Source priority:
//   1. `x-request-id` header — if the caller sent one (load balancer,
//      Vercel edge, manual curl, integration tests), preserve it.
//   2. `x-vercel-id` header — Vercel sets this on every request to the
//      function. Useful for cross-referencing with Vercel function logs.
//   3. Locally generated nanoid (12 chars URL-safe).
//
// The generated id is 12 chars of nanoid alphabet (6e10 IDs before 1%
// collision probability — way more than enough for per-request scope).

import { nanoid } from 'nanoid';
import type { NextRequest } from 'next/server';
import { childLogger, type RequestLogContext } from './logger';

const NANOID_LEN = 12;

// p6-8 (Codex audit): tighten the regex on caller-supplied request IDs so
// log indexers don't pollute on high-cardinality / control-char input.
// Allowed: URL-safe chars only, 8-128 chars. Anything outside this gets
// replaced with a fresh local id.
const REQUEST_ID_RE = /^[A-Za-z0-9._\-:]{8,128}$/;

export function getRequestId(req: NextRequest | Request): string {
  const incoming = req.headers.get('x-request-id') ?? req.headers.get('x-vercel-id');
  if (incoming && REQUEST_ID_RE.test(incoming)) return incoming;
  return nanoid(NANOID_LEN);
}

/**
 * Convenience wrapper: derives request_id, builds a child logger bound to
 * { request_id, method, path, route?, ... }, and returns it. Pass `route`
 * for static identification (e.g. 'auth/login' regardless of dynamic
 * segments).
 */
export function loggerFor(req: NextRequest | Request, extra: Omit<RequestLogContext, 'request_id'> = {}) {
  const request_id = getRequestId(req);
  const url = new URL(req.url);
  return {
    request_id,
    log: childLogger({
      request_id,
      method: (req as Request).method,
      path: url.pathname,
      ...extra,
    }),
  };
}
