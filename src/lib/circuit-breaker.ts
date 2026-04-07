// Circuit breaker pattern per API provider
// After N consecutive failures, stop calling the API for a cooldown period
// Prevents hammering a down API and wasting rate limit budget

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitConfig {
  failureThreshold: number;  // consecutive failures before opening
  cooldownMs: number;        // how long to stay open
  halfOpenMaxAttempts: number; // test requests in half-open state
}

interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
}

class CircuitBreaker {
  private config: CircuitConfig;
  private status: CircuitStatus;

  constructor(config: Partial<CircuitConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      cooldownMs: config.cooldownMs ?? 60_000,
      halfOpenMaxAttempts: config.halfOpenMaxAttempts ?? 1,
    };
    this.status = {
      state: 'CLOSED',
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }

  get state(): CircuitState {
    if (this.status.state === 'OPEN') {
      const elapsed = Date.now() - (this.status.openedAt ?? 0);
      if (elapsed >= this.config.cooldownMs) {
        this.status.state = 'HALF_OPEN';
      }
    }
    return this.status.state;
  }

  canRequest(): boolean {
    const current = this.state;
    if (current === 'CLOSED') return true;
    if (current === 'HALF_OPEN') return true;
    return false; // OPEN
  }

  recordSuccess(): void {
    this.status.failures = 0;
    this.status.lastSuccess = Date.now();
    this.status.totalSuccesses++;
    if (this.status.state === 'HALF_OPEN') {
      this.status.state = 'CLOSED';
      this.status.openedAt = null;
    }
  }

  recordFailure(): void {
    this.status.failures++;
    this.status.lastFailure = Date.now();
    this.status.totalFailures++;
    if (this.status.failures >= this.config.failureThreshold) {
      this.status.state = 'OPEN';
      this.status.openedAt = Date.now();
    }
  }

  get stats() {
    return {
      state: this.state,
      consecutiveFailures: this.status.failures,
      totalFailures: this.status.totalFailures,
      totalSuccesses: this.status.totalSuccesses,
      lastFailure: this.status.lastFailure,
      lastSuccess: this.status.lastSuccess,
      cooldownMs: this.config.cooldownMs,
      failureThreshold: this.config.failureThreshold,
    };
  }

  reset(): void {
    this.status = {
      state: 'CLOSED',
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
      totalFailures: this.status.totalFailures,
      totalSuccesses: this.status.totalSuccesses,
    };
  }
}

// Global circuit breakers — one per API provider
export const circuitBreakers = {
  finnhub: new CircuitBreaker(),
  fred: new CircuitBreaker(),
  polygon: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 120_000 }), // tighter since 5/min limit
  quiver: new CircuitBreaker(),
  fmp: new CircuitBreaker(),
  attom: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 300_000 }), // very conservative
  census: new CircuitBreaker(),
  openweather: new CircuitBreaker(),
  newsapi: new CircuitBreaker(),
  gnews: new CircuitBreaker(),
  nasdaq: new CircuitBreaker(),
  edgar: new CircuitBreaker(),
  stocktwits: new CircuitBreaker(),
  alpaca: new CircuitBreaker(),
  unusualwhales: new CircuitBreaker(),
} as const;

export type CircuitProvider = keyof typeof circuitBreakers;

export function canCallApi(provider: CircuitProvider): boolean {
  return circuitBreakers[provider].canRequest();
}

export function recordApiSuccess(provider: CircuitProvider): void {
  circuitBreakers[provider].recordSuccess();
}

export function recordApiFailure(provider: CircuitProvider): void {
  circuitBreakers[provider].recordFailure();
}

type CircuitStats = { state: CircuitState; consecutiveFailures: number; totalFailures: number; totalSuccesses: number; lastFailure: number | null; lastSuccess: number | null; cooldownMs: number; failureThreshold: number };

export function getAllCircuitStats() {
  const stats: Record<string, CircuitStats> = {};
  for (const [name, breaker] of Object.entries(circuitBreakers)) {
    stats[name] = (breaker as CircuitBreaker).stats;
  }
  return stats;
}
