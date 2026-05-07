import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

/**
 * Minimal liveness endpoint (P0-3, hardening/p0-codex-fixes).
 *
 * `/api/health` used to be middleware-public AND returned full env validity,
 * provider rate-limit state, circuit-breaker state, and a ring buffer of
 * recent upstream API errors. Anyone could fingerprint the entire backend
 * without authenticating. This endpoint is the new public probe — emits
 * only `{ status, timestamp }` so Vercel uptime checks keep working without
 * leaking operational internals.
 *
 * The rich `/api/health` payload now sits behind the session-cookie gate so
 * only the dashboard can see it.
 *
 * p1-6: rate-limited (60/min per IP) so this can't be turned into a free
 * DoS amplifier or low-cost fingerprinting probe. 60/min is generous —
 * every legitimate uptime monitor I'm aware of polls at most every 15s.
 */
export async function GET(req: NextRequest) {
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('healthz', key, 60, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
