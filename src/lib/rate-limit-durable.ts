/**
 * Durable rate limiter — backed by Supabase.
 *
 * Adversarial-QA finding (Fix 4, MED): the in-memory `rate-limit.ts` keeps
 * counters in a module-level Map. On Vercel each warm/cold serverless
 * instance has its own copy, so under sustained load the effective rate
 * limit becomes (declared × N instances). For high-cost endpoints
 * (research, debate, crew, briefing-refresh) that's a real wallet risk.
 *
 * This wrapper hits the `rate_limit_hit` Postgres RPC which atomically
 * increments a per-bucket counter. Identical limit no matter how many
 * instances are running.
 *
 * Usage in a route:
 *   const limit = await checkRateLimitDurable('research-start', 'wes', 4, 300);
 *   if (!limit.allowed) return new Response('Too many requests', { status: 429 });
 *
 * Falls back to the in-memory limiter if Supabase is unreachable so a DB
 * outage doesn't lock the user out entirely.
 */

import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit as inMemoryRateLimit } from '@/lib/rate-limit';
import { verifySessionJwt, SESSION_COOKIE_NAME } from '@/lib/session';

export type DurableRateLimitResult = {
  allowed: boolean;
  count: number;
  reset_at: string | null;
  source: 'durable' | 'memory-fallback';
};

/**
 * Pull the most identifying key out of an authenticated request — the
 * session subject if present, falling back to a forwarded IP. Used by the
 * durable limiter so the same browser hitting two warm Vercel instances
 * counts against the same bucket.
 *
 * Vercel sets `x-forwarded-for` and `x-real-ip` on every inbound request
 * (the original `req.ip` was removed in Next 14.1+). We coalesce both.
 */
export async function getRateLimitIdentity(req: NextRequest): Promise<{
  key: string;
  source: 'session' | 'ip' | 'unknown';
}> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  const session = await verifySessionJwt(cookie?.value);
  if (session?.sub) {
    return { key: `sub:${session.sub}`, source: 'session' };
  }
  const xff = req.headers.get('x-forwarded-for');
  const ip = xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  if (ip) return { key: `ip:${ip}`, source: 'ip' };
  return { key: 'unknown', source: 'unknown' };
}

/**
 * Synchronous IP-only resolver — for routes that pre-date authentication
 * (login) and don't need the JWT round-trip.
 */
export function getIpKey(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const ip = xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  return ip ? `ip:${ip}` : 'ip:unknown';
}

export async function checkRateLimitDurable(
  endpoint: string,
  userId: string,
  limit: number,
  windowSeconds: number,
): Promise<DurableRateLimitResult> {
  const key = `${endpoint}:${userId}`;
  try {
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_s: windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = (data as unknown as Array<{ allowed: boolean; count: number; reset_at: string }>)?.[0];
    if (!row) throw new Error('empty rate_limit_hit response');
    return {
      allowed: row.allowed,
      count: row.count,
      reset_at: row.reset_at,
      source: 'durable',
    };
  } catch {
    // Fall back to the in-memory limiter so a Supabase outage doesn't lock
    // the user out. The fallback is per-instance, but at least it caps abuse.
    const fallback = inMemoryRateLimit(key, limit, windowSeconds * 1000);
    return {
      allowed: fallback.allowed,
      count: 0,
      reset_at: null,
      source: 'memory-fallback',
    };
  }
}
