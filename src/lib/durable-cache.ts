// Durable cross-instance cache backed by the kv_cache table.
//
// The in-memory server-cache (src/lib/server-cache.ts) is per-lambda on
// Vercel: a value written by a cron invocation is invisible to the instance
// serving the dashboard. Use this module for state that must survive across
// instances and cold starts (e.g. the market narrative). A short in-memory
// layer sits on top so hot paths don't hit Postgres on every read.

import { createServiceClient } from '@/lib/supabase';
import { getCached, setCache } from '@/lib/server-cache';

const MEM_LAYER_TTL_MS = 60 * 1000;

export async function getDurable<T>(key: string): Promise<T | null> {
  const mem = getCached<T>(`durable:${key}`);
  if (mem !== null) return mem;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('kv_cache')
      .select('value, expires_at')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
    setCache(`durable:${key}`, data.value as T, MEM_LAYER_TTL_MS);
    return data.value as T;
  } catch {
    return null;
  }
}

export async function setDurable<T>(key: string, value: T, ttlMs: number | null): Promise<boolean> {
  // Memory layer is always correct for this instance — it holds the value we
  // just computed even when the durable write below fails.
  setCache(`durable:${key}`, value, ttlMs === null ? MEM_LAYER_TTL_MS : Math.min(ttlMs, MEM_LAYER_TTL_MS));
  try {
    const supabase = createServiceClient();
    // supabase-js reports failures via { error }, it does not throw.
    const { error } = await supabase.from('kv_cache').upsert({
      key,
      value,
      expires_at: ttlMs === null ? null : new Date(Date.now() + ttlMs).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[durable-cache] durable write failed', key, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[durable-cache] durable write threw', key, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Atomically prepend an entry to a jsonb-array key, keeping the newest `cap`
 * entries. Concurrent writers cannot lose each other's entries (the trim +
 * prepend happen in one statement via kv_append_capped()).
 */
export async function appendDurableCapped(key: string, entry: unknown, cap: number): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc('kv_append_capped', { entry_key: key, entry, cap });
    if (error) {
      console.error('[durable-cache] append failed', key, error.message);
      return false;
    }
    // The memory layer for this key is now stale on this instance; drop it so
    // the next getDurable re-reads the merged list.
    setCache(`durable:${key}`, null as unknown, 1);
    return true;
  } catch (err) {
    console.error('[durable-cache] append threw', key, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Atomic distributed lock lease via kv_try_lock(). Returns true when this
 * caller acquired the lease. Fails OPEN on infrastructure errors: for our
 * uses (regeneration cooldowns) doing the work twice beats wedging it, and
 * the durable rate limiter still caps total spend.
 */
export async function tryAcquireDurableLock(key: string, ttlMs: number): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('kv_try_lock', { lock_key: key, ttl_ms: ttlMs });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
