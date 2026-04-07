// Health monitoring system for all data sources
// Tracks status, latency, error rates, and generates alerts

import { getAllRateLimitStats, type ApiProvider } from './rate-limiter';
import { getAllCircuitStats, type CircuitProvider } from './circuit-breaker';
import { getRecentApiLogs } from './api-client';

export interface DataSourceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'unconfigured';
  configured: boolean;
  lastSuccess: string | null;
  lastError: string | null;
  errorRate: number;          // percentage over last N calls
  avgLatencyMs: number;
  callsLast5Min: number;
  rateLimitRemaining: number;
  rateLimitMax: number;
  circuitState: string;
}

export function getDataSourceHealth(): DataSourceHealth[] {
  const rateLimits = getAllRateLimitStats();
  const circuits = getAllCircuitStats();
  const logs = getRecentApiLogs(100);

  const sources: DataSourceHealth[] = [];

  const configs: { name: string; envVar: string; provider: string }[] = [
    { name: 'Alpaca', envVar: 'ALPACA_API_KEY', provider: 'alpaca' },
    { name: 'FMP', envVar: 'FMP_API_KEY', provider: 'fmp' },
    { name: 'Finnhub', envVar: 'FINNHUB_API_KEY', provider: 'finnhub' },
    { name: 'FRED', envVar: 'FRED_API_KEY', provider: 'fred' },
    { name: 'Polygon', envVar: 'POLYGON_API_KEY', provider: 'polygon' },
    { name: 'OpenWeather', envVar: 'OPENWEATHER_API_KEY', provider: 'openweather' },
    { name: 'NewsAPI', envVar: 'NEWSAPI_KEY', provider: 'newsapi' },
    { name: 'GNews', envVar: 'GNEWS_API_KEY', provider: 'gnews' },
    { name: 'Census', envVar: 'CENSUS_API_KEY', provider: 'census' },
    { name: 'FEMA', envVar: '', provider: 'edgar' }, // free, no key
    { name: 'SEC EDGAR', envVar: '', provider: 'edgar' },
    { name: 'StockTwits', envVar: '', provider: 'stocktwits' },
  ];

  for (const config of configs) {
    const configured = config.envVar === '' || !!process.env[config.envVar];
    const rateLimit = rateLimits[config.provider as ApiProvider];
    const circuit = circuits[config.provider as CircuitProvider];

    // Calculate metrics from recent logs
    const apiLogs = logs.filter(l => l.api === config.provider);
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentLogs = apiLogs.filter(l => new Date(l.timestamp).getTime() > fiveMinAgo);

    const errors = recentLogs.filter(l => l.status === 'error').length;
    const total = recentLogs.length;
    const errorRate = total > 0 ? Math.round((errors / total) * 100) : 0;
    const avgLatency = total > 0
      ? Math.round(recentLogs.reduce((sum, l) => sum + l.latencyMs, 0) / total)
      : 0;

    const lastSuccess = apiLogs.find(l => l.status === 'success')?.timestamp ?? null;
    const lastError = apiLogs.find(l => l.status === 'error')?.timestamp ?? null;

    let status: DataSourceHealth['status'];
    if (!configured) {
      status = 'unconfigured';
    } else if (circuit?.state === 'OPEN') {
      status = 'down';
    } else if (errorRate > 50 || circuit?.state === 'HALF_OPEN') {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    sources.push({
      name: config.name,
      status,
      configured,
      lastSuccess,
      lastError,
      errorRate,
      avgLatencyMs: avgLatency,
      callsLast5Min: recentLogs.length,
      rateLimitRemaining: rateLimit?.remaining ?? 0,
      rateLimitMax: rateLimit?.max ?? 0,
      circuitState: circuit?.state ?? 'unknown',
    });
  }

  return sources;
}

export function getSystemHealthSummary() {
  const sources = getDataSourceHealth();
  const healthy = sources.filter(s => s.status === 'healthy').length;
  const degraded = sources.filter(s => s.status === 'degraded').length;
  const down = sources.filter(s => s.status === 'down').length;
  const unconfigured = sources.filter(s => s.status === 'unconfigured').length;
  const configured = sources.length - unconfigured;

  return {
    overall: down > 0 ? 'critical' as const : degraded > 0 ? 'degraded' as const : 'healthy' as const,
    sources,
    counts: { healthy, degraded, down, unconfigured, configured, total: sources.length },
  };
}
