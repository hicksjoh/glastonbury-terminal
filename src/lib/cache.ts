// Session-based cache utility for offline/stale data support

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

const DEFAULT_TTL = 300000; // 5 minutes

export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + ttlMs,
    };
    sessionStorage.setItem(`gt_cache_${key}`, JSON.stringify(entry));
  } catch {
    // sessionStorage full or unavailable — silently fail
  }
}

export function cacheGet<T>(key: string): { data: T; isStale: boolean; ageMs: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`gt_cache_${key}`);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    const now = Date.now();
    const isStale = now > entry.expiry;
    return {
      data: entry.data,
      isStale,
      ageMs: now - entry.timestamp,
    };
  } catch {
    return null;
  }
}

export function cacheDelete(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(`gt_cache_${key}`);
  } catch {
    // silently fail
  }
}

export function formatStaleAge(ageMs: number): string {
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins === 1) return '1 minute';
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  return `${hours} hour${hours > 1 ? 's' : ''}`;
}
