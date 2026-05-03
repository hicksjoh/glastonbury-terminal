import { NextResponse } from 'next/server';

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
 */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
