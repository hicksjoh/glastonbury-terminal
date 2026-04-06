const rateMap = new Map<string, { count: number; resetAt: number }>();

function cleanupExpiredEntries(): void {
  if (rateMap.size <= 10000) return;
  const now = Date.now();
  rateMap.forEach((entry, key) => {
    if (now > entry.resetAt) {
      rateMap.delete(key);
    }
  });
}

export function rateLimit(key: string, limit: number = 60, windowMs: number = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    cleanupExpiredEntries();
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  if (entry.count > limit) {
    cleanupExpiredEntries();
    return { allowed: false, remaining: 0 };
  }
  cleanupExpiredEntries();
  return { allowed: true, remaining: limit - entry.count };
}
