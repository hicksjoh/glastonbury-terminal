// Token-bucket rate limiter per API provider
// Prevents exceeding free-tier limits across all routes

interface BucketConfig {
  maxTokens: number;
  refillRate: number;       // tokens added per interval
  refillIntervalMs: number; // how often to refill
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  totalConsumed: number;
  totalRejected: number;
}

class TokenBucket {
  private config: BucketConfig;
  private state: BucketState;

  constructor(config: BucketConfig) {
    this.config = config;
    this.state = {
      tokens: config.maxTokens,
      lastRefill: Date.now(),
      totalConsumed: 0,
      totalRejected: 0,
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.state.lastRefill;
    const intervals = Math.floor(elapsed / this.config.refillIntervalMs);
    if (intervals > 0) {
      this.state.tokens = Math.min(
        this.config.maxTokens,
        this.state.tokens + intervals * this.config.refillRate,
      );
      this.state.lastRefill = now;
    }
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.state.tokens >= count) {
      this.state.tokens -= count;
      this.state.totalConsumed += count;
      return true;
    }
    this.state.totalRejected += count;
    return false;
  }

  get remaining(): number {
    this.refill();
    return Math.floor(this.state.tokens);
  }

  get stats() {
    this.refill();
    return {
      remaining: Math.floor(this.state.tokens),
      max: this.config.maxTokens,
      totalConsumed: this.state.totalConsumed,
      totalRejected: this.state.totalRejected,
      refillRate: this.config.refillRate,
      refillIntervalMs: this.config.refillIntervalMs,
    };
  }
}

// Global rate limiters — one per API provider
// These are hard constraints from each provider's free tier
export const rateLimiters = {
  // 60 calls/min
  finnhub: new TokenBucket({ maxTokens: 60, refillRate: 60, refillIntervalMs: 60_000 }),
  // 120 calls/min
  fred: new TokenBucket({ maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 }),
  // 5 calls/min — TIGHT, the bottleneck
  polygon: new TokenBucket({ maxTokens: 5, refillRate: 5, refillIntervalMs: 60_000 }),
  // ~100 calls/day
  quiver: new TokenBucket({ maxTokens: 100, refillRate: 100, refillIntervalMs: 86_400_000 }),
  // 250 calls/day
  fmp: new TokenBucket({ maxTokens: 250, refillRate: 250, refillIntervalMs: 86_400_000 }),
  // 150 calls/month — VERY TIGHT
  attom: new TokenBucket({ maxTokens: 5, refillRate: 5, refillIntervalMs: 86_400_000 }),
  // 500 calls/day
  census: new TokenBucket({ maxTokens: 500, refillRate: 500, refillIntervalMs: 86_400_000 }),
  // 60 calls/min
  openweather: new TokenBucket({ maxTokens: 60, refillRate: 60, refillIntervalMs: 60_000 }),
  // 100 calls/day
  newsapi: new TokenBucket({ maxTokens: 100, refillRate: 100, refillIntervalMs: 86_400_000 }),
  // 100 calls/day
  gnews: new TokenBucket({ maxTokens: 100, refillRate: 100, refillIntervalMs: 86_400_000 }),
  // 50 calls/day
  nasdaq: new TokenBucket({ maxTokens: 50, refillRate: 50, refillIntervalMs: 86_400_000 }),
  // 10 req/sec
  edgar: new TokenBucket({ maxTokens: 10, refillRate: 10, refillIntervalMs: 1_000 }),
  // 200 calls/hr
  stocktwits: new TokenBucket({ maxTokens: 200, refillRate: 200, refillIntervalMs: 3_600_000 }),
  // Unusual Whales (congress free tier)
  unusualwhales: new TokenBucket({ maxTokens: 100, refillRate: 100, refillIntervalMs: 86_400_000 }),
  // Alpaca REST (generous)
  alpaca: new TokenBucket({ maxTokens: 200, refillRate: 200, refillIntervalMs: 60_000 }),
} as const;

export type ApiProvider = keyof typeof rateLimiters;

export function checkRateLimit(provider: ApiProvider): boolean {
  return rateLimiters[provider].tryConsume();
}

export function getRateLimitRemaining(provider: ApiProvider): number {
  return rateLimiters[provider].remaining;
}

export function getAllRateLimitStats() {
  const stats: Record<string, { remaining: number; max: number; totalConsumed: number; totalRejected: number; refillRate: number; refillIntervalMs: number }> = {};
  for (const [name, limiter] of Object.entries(rateLimiters)) {
    stats[name] = (limiter as TokenBucket).stats;
  }
  return stats;
}
