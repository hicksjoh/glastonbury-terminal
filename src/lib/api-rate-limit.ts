/**
 * One-line durable rate limiting for API route handlers.
 *
 * CLAUDE.md rule 6 says "Every API route needs rate-limit + auth." Auth held —
 * middleware enforces it — but the limiter half had drifted: roughly 95 of the
 * 147 route files called no limiter at all, and the ones that did mostly used
 * `src/lib/rate-limit.ts`, a module-local `Map`. On Vercel that means each warm
 * lambda keeps its own counter and every cold start resets it, so the effective
 * ceiling is (limit x instance count) and an attacker simply fans out.
 *
 * This wrapper uses the Supabase-backed counter, which is shared across
 * instances, and keys on the authenticated session subject when there is one so
 * a single session cannot multiply its allowance by rotating source IPs.
 *
 * Usage:
 *
 *   export const GET = withRateLimit('sectors', RATE.READ, async (req) => { ... });
 *
 * Deliberately NOT applied in middleware: the durable counter is a Supabase
 * round trip, and putting that in front of every asset and page request would
 * add latency to the whole app. Route-level is the right granularity, and it
 * lets expensive endpoints carry tighter limits than cheap ones.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getIpKey } from './rate-limit-durable';
import { verifySessionJwt } from './session';

export interface RateSpec {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * Refuse the request when the durable store is unavailable rather than
   * falling through to the per-instance counter. Reserve for endpoints that
   * move money or mint credentials; a degraded limiter on a read endpoint is
   * better than an outage.
   */
  failClosed?: boolean;
}

/** Shared budgets, so limits are chosen from a short list rather than invented. */
export const RATE = {
  /** Cheap reads off our own database or cache. */
  READ: { limit: 120, windowSeconds: 60 } as RateSpec,
  /** Reads that burn a third-party quota (FMP, Finnhub, Polygon, Alpaca). */
  UPSTREAM: { limit: 40, windowSeconds: 60 } as RateSpec,
  /** Anything that bills an LLM call or runs a heavy computation. */
  EXPENSIVE: { limit: 10, windowSeconds: 60 } as RateSpec,
  /** Writes to our own state. */
  WRITE: { limit: 30, windowSeconds: 60 } as RateSpec,
  /** Order placement and other irreversible actions. */
  CRITICAL: { limit: 10, windowSeconds: 60, failClosed: true } as RateSpec,
  /**
   * Status endpoints a page polls on a timer. /research and /research/[id]
   * poll every 5s = 12 req/min, so any ceiling at or below that would 429 a
   * long-running research job mid-flight and make it look stuck. Must stay
   * comfortably above the fastest poll interval in the UI.
   */
  POLL: { limit: 60, windowSeconds: 60 } as RateSpec,
  /**
   * Public asset proxying. One news page render fires ~30 image requests in a
   * single burst, so a 40/min ceiling would break the page it serves.
   */
  ASSET: { limit: 300, windowSeconds: 60 } as RateSpec,
} as const;

/**
 * Identity to meter against: the authenticated session subject where one
 * exists, otherwise the source IP. Session-keying matters because every
 * authenticated caller here is the same human — IP-keying alone would let one
 * session behind a rotating egress bypass the ceiling entirely.
 */
async function rateKeyFor(req: NextRequest): Promise<string> {
  try {
    const token = req.cookies.get('gt-auth')?.value;
    if (token) {
      const session = await verifySessionJwt(token);
      if (session?.sub) return `sub:${session.sub}`;
    }
  } catch {
    // Fall through to IP keying — this is metering, not authorization.
  }
  return getIpKey(req);
}

type Handler<C> = (req: NextRequest, context: C) => Promise<Response> | Response;

export function withRateLimit<C>(
  endpoint: string,
  spec: RateSpec,
  handler: Handler<C>,
): Handler<C> {
  return async (req: NextRequest, context: C) => {
    const key = await rateKeyFor(req);
    const result = await checkRateLimitDurable(endpoint, key, spec.limit, spec.windowSeconds);

    if (!result.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', endpoint },
        {
          status: 429,
          headers: {
            'retry-after': String(spec.windowSeconds),
            'x-ratelimit-limit': String(spec.limit),
            'x-ratelimit-remaining': '0',
          },
        },
      );
    }

    if (spec.failClosed && result.source === 'memory-fallback') {
      return NextResponse.json(
        { error: 'Temporarily unavailable (rate-limit store degraded). Retry shortly.', endpoint },
        { status: 503, headers: { 'retry-after': '30' } },
      );
    }

    return handler(req, context);
  };
}
