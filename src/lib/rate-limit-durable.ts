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

import { createServiceClient } from '@/lib/supabase';
import { rateLimit as inMemoryRateLimit } from '@/lib/rate-limit';

export type DurableRateLimitResult = {
  allowed: boolean;
  count: number;
  reset_at: string | null;
  source: 'durable' | 'memory-fallback';
};

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
