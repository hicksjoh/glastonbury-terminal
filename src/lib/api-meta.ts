// Standardized _meta field for every API response
// Makes it impossible for mock data to hide — every response declares its source

import { type ApiProvider, getRateLimitRemaining } from './rate-limiter';

export interface ApiMeta {
  source: string;          // which API provided the data (e.g. 'finnhub', 'fmp', 'fallback')
  live: boolean;           // true = real data from API, false = fallback/mock
  stale: boolean;          // cache expired but serving old data
  cached: boolean;         // served from cache
  fetchedAt: string;       // ISO timestamp of when data was fetched
  rateLimitRemaining?: number; // calls left in current window
  cacheExpiresAt?: string; // ISO timestamp of cache expiry
  latencyMs?: number;      // how long the API call took
  error?: string;          // error message if fallback was used
}

interface BuildMetaOptions {
  source: string;
  live: boolean;
  stale?: boolean;
  cached?: boolean;
  fetchedAt?: string;
  provider?: ApiProvider;
  cacheExpiresAt?: number;
  latencyMs?: number;
  error?: string;
}

export function buildMeta(opts: BuildMetaOptions): ApiMeta {
  const meta: ApiMeta = {
    source: opts.source,
    live: opts.live,
    stale: opts.stale ?? false,
    cached: opts.cached ?? false,
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
  };

  if (opts.provider) {
    meta.rateLimitRemaining = getRateLimitRemaining(opts.provider);
  }

  if (opts.cacheExpiresAt) {
    meta.cacheExpiresAt = new Date(opts.cacheExpiresAt).toISOString();
  }

  if (opts.latencyMs !== undefined) {
    meta.latencyMs = Math.round(opts.latencyMs);
  }

  if (opts.error) {
    meta.error = opts.error;
  }

  return meta;
}

// Convenience builders for common patterns
export function liveMeta(source: string, provider?: ApiProvider, latencyMs?: number): ApiMeta {
  return buildMeta({ source, live: true, provider: provider as ApiProvider, latencyMs });
}

export function cachedMeta(source: string, fetchedAt: string, expiresAt: number, provider?: ApiProvider): ApiMeta {
  return buildMeta({
    source,
    live: true,
    cached: true,
    fetchedAt,
    cacheExpiresAt: expiresAt,
    provider: provider as ApiProvider,
  });
}

export function staleMeta(source: string, fetchedAt: string, provider?: ApiProvider, error?: string): ApiMeta {
  return buildMeta({
    source,
    live: true,
    stale: true,
    cached: true,
    fetchedAt,
    provider: provider as ApiProvider,
    error,
  });
}

export function fallbackMeta(source: string, error: string, provider?: ApiProvider): ApiMeta {
  return buildMeta({ source: `fallback:${source}`, live: false, error, provider: provider as ApiProvider });
}
