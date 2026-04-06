// Server-side in-memory cache for API route deduplication
// Reduces redundant external API calls within TTL windows

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// TTL presets
export const TTL = {
  REALTIME: 10 * 1000,      // 10 seconds - prices
  SHORT: 60 * 1000,         // 1 minute - positions, account
  MEDIUM: 5 * 60 * 1000,    // 5 minutes - news, sectors
  LONG: 60 * 60 * 1000,     // 1 hour - fundamentals, screener
  DAY: 24 * 60 * 60 * 1000, // 24 hours - historical data
};
