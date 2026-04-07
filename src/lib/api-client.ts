// Centralized API client for all external data sources
// Every external HTTP call goes through this — rate limiting, circuit breaking,
// caching, structured logging, and _meta tagging in one place.

import { getCached, setCache } from './server-cache';
import { type ApiProvider, checkRateLimit, getRateLimitRemaining } from './rate-limiter';
import { type CircuitProvider, canCallApi, recordApiSuccess, recordApiFailure } from './circuit-breaker';
import { type ApiMeta, buildMeta } from './api-meta';

// API base URLs
const API_BASES: Record<string, string> = {
  finnhub: 'https://finnhub.io/api/v1',
  fred: 'https://api.stlouisfed.org/fred',
  polygon: 'https://api.polygon.io',
  quiver: 'https://api.quiverquant.com/beta',
  fmp: 'https://financialmodelingprep.com/api',
  attom: 'https://api.gateway.attomdata.com/propertyapi/v1.0.0',
  census: 'https://api.census.gov/data',
  openweather: 'https://api.openweathermap.org/data/2.5',
  newsapi: 'https://newsapi.org/v2',
  gnews: 'https://gnews.io/api/v4',
  nasdaq: 'https://data.nasdaq.com/api/v3',
  edgar: 'https://data.sec.gov',
  stocktwits: 'https://api.stocktwits.com/api/2',
  unusualwhales: 'https://api.unusualwhales.com/api',
  alpaca: 'https://paper-api.alpaca.markets',
  alpaca_data: 'https://data.alpaca.markets',
  cboe: 'https://cdn.cboe.com/api/global',
  fema: 'https://www.fema.gov/api/open',
  sba: 'https://data.sba.gov/dataset',
};

// How each API authenticates
type AuthStyle = 'query' | 'header' | 'bearer' | 'none';

interface ApiConfig {
  auth: AuthStyle;
  keyParam?: string;       // query param name for API key
  headerName?: string;     // header name for API key
  envVar: string;          // env var holding the key
  provider: ApiProvider & CircuitProvider;
  userAgent?: string;      // required by SEC EDGAR
}

const API_CONFIGS: Record<string, ApiConfig> = {
  finnhub: { auth: 'query', keyParam: 'token', envVar: 'FINNHUB_API_KEY', provider: 'finnhub' },
  fred: { auth: 'query', keyParam: 'api_key', envVar: 'FRED_API_KEY', provider: 'fred' },
  polygon: { auth: 'query', keyParam: 'apiKey', envVar: 'POLYGON_API_KEY', provider: 'polygon' },
  quiver: { auth: 'bearer', envVar: 'QUIVER_API_KEY', provider: 'quiver' },
  fmp: { auth: 'query', keyParam: 'apikey', envVar: 'FMP_API_KEY', provider: 'fmp' },
  attom: { auth: 'header', headerName: 'apikey', envVar: 'ATTOM_API_KEY', provider: 'attom' },
  census: { auth: 'query', keyParam: 'key', envVar: 'CENSUS_API_KEY', provider: 'census' },
  openweather: { auth: 'query', keyParam: 'appid', envVar: 'OPENWEATHER_API_KEY', provider: 'openweather' },
  newsapi: { auth: 'header', headerName: 'X-Api-Key', envVar: 'NEWSAPI_KEY', provider: 'newsapi' },
  gnews: { auth: 'query', keyParam: 'apikey', envVar: 'GNEWS_API_KEY', provider: 'gnews' },
  nasdaq: { auth: 'query', keyParam: 'api_key', envVar: 'NASDAQ_DATA_LINK_API_KEY', provider: 'nasdaq' },
  edgar: { auth: 'none', envVar: '', provider: 'edgar', userAgent: 'GlastonburyTerminal/1.0 hicksjoh@gmail.com' },
  stocktwits: { auth: 'none', envVar: '', provider: 'stocktwits' },
  unusualwhales: { auth: 'bearer', envVar: 'UNUSUAL_WHALES_API_KEY', provider: 'unusualwhales' },
};

interface FetchOptions {
  cacheTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface ApiResult<T> {
  data: T;
  _meta: ApiMeta;
}

interface LogEntry {
  api: string;
  endpoint: string;
  status: 'success' | 'error' | 'rate_limited' | 'circuit_open' | 'cached';
  latencyMs: number;
  error?: string;
  timestamp: string;
}

// In-memory log buffer — flushed to Supabase periodically in Phase 3
const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER = 200;

function logApiCall(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
}

export function getRecentApiLogs(count = 50): LogEntry[] {
  return logBuffer.slice(-count);
}

// Main fetch function — the single gateway for all external API calls
export async function apiFetch<T>(
  api: string,
  endpoint: string,
  params: Record<string, string> = {},
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  const config = API_CONFIGS[api];
  if (!config) throw new Error(`Unknown API: ${api}`);

  const { cacheTtlMs = 60_000, timeoutMs = 10_000, retries = 1 } = options;
  const cacheKey = `${api}:${endpoint}:${JSON.stringify(params)}`;

  // 1. Check cache first
  const cached = getCached<{ data: T; fetchedAt: string; expiresAt: number }>(cacheKey);
  if (cached) {
    logApiCall({ api, endpoint, status: 'cached', latencyMs: 0, timestamp: new Date().toISOString() });
    return {
      data: cached.data,
      _meta: buildMeta({
        source: api,
        live: true,
        cached: true,
        fetchedAt: cached.fetchedAt,
        cacheExpiresAt: cached.expiresAt,
        provider: config.provider as ApiProvider,
      }),
    };
  }

  // 2. Check circuit breaker
  if (!canCallApi(config.provider)) {
    logApiCall({ api, endpoint, status: 'circuit_open', latencyMs: 0, timestamp: new Date().toISOString() });
    throw new ApiError(api, endpoint, 'Circuit breaker OPEN — API is temporarily unavailable');
  }

  // 3. Check rate limit
  if (!checkRateLimit(config.provider as ApiProvider)) {
    logApiCall({ api, endpoint, status: 'rate_limited', latencyMs: 0, timestamp: new Date().toISOString() });
    throw new ApiError(api, endpoint, `Rate limit exceeded for ${api}`);
  }

  // 4. Build URL
  const base = API_BASES[api] ?? '';
  const url = new URL(`${base}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  // Add API key via query param if applicable
  const apiKey = config.envVar ? (process.env[config.envVar] ?? '') : '';
  if (config.auth === 'query' && config.keyParam && apiKey) {
    url.searchParams.set(config.keyParam, apiKey);
  }

  // 5. Build headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (config.auth === 'header' && config.headerName && apiKey) {
    headers[config.headerName] = apiKey;
  }
  if (config.auth === 'bearer' && apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (config.userAgent) {
    headers['User-Agent'] = config.userAgent;
  }

  // 6. Fetch with retry
  let lastError: Error | null = null;
  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url.toString(), {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json() as T;
      recordApiSuccess(config.provider);

      // Cache the result
      const fetchedAt = new Date().toISOString();
      const expiresAt = Date.now() + cacheTtlMs;
      setCache(cacheKey, { data, fetchedAt, expiresAt }, cacheTtlMs);

      logApiCall({ api, endpoint, status: 'success', latencyMs, timestamp: fetchedAt });

      return {
        data,
        _meta: buildMeta({
          source: api,
          live: true,
          provider: config.provider as ApiProvider,
          latencyMs,
          fetchedAt,
          cacheExpiresAt: expiresAt,
        }),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  // All retries failed
  const latencyMs = Date.now() - start;
  recordApiFailure(config.provider);
  logApiCall({
    api, endpoint, status: 'error', latencyMs,
    error: lastError?.message, timestamp: new Date().toISOString(),
  });

  throw new ApiError(api, endpoint, lastError?.message ?? 'Unknown error');
}

export class ApiError extends Error {
  api: string;
  endpoint: string;

  constructor(api: string, endpoint: string, message: string) {
    super(`[${api}] ${endpoint}: ${message}`);
    this.api = api;
    this.endpoint = endpoint;
  }
}

// Convenience: fetch with fallback data on failure
export async function apiFetchWithFallback<T>(
  api: string,
  endpoint: string,
  params: Record<string, string>,
  fallback: T,
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  try {
    return await apiFetch<T>(api, endpoint, params, options);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return {
      data: fallback,
      _meta: buildMeta({
        source: `fallback:${api}`,
        live: false,
        error,
        provider: (API_CONFIGS[api]?.provider ?? api) as ApiProvider,
      }),
    };
  }
}
