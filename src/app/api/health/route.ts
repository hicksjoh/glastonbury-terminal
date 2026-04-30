import { NextResponse } from 'next/server';
import { getAllRateLimitStats } from '@/lib/rate-limiter';
import { getAllCircuitStats } from '@/lib/circuit-breaker';
import { checkEnvironment } from '@/lib/env-check';
import { getCached, setCache } from '@/lib/server-cache';

type ServiceStatus = 'ok' | 'error' | 'unconfigured' | 'degraded';

// The health endpoint is called from the dashboard's Connections widget on
// every mount. Each call pings Alpaca / FMP / Supabase / Claude — which
// meant a tab refresh was burning 4 upstream API calls *per refresh*.
// FMP in particular rate-limits aggressively on the free tier. Cache the
// full health payload briefly so a fresh dashboard load doesn't DDoS us.
const HEALTH_CACHE_KEY = 'health:full';
const HEALTH_CACHE_TTL_MS = 60 * 1000;

export async function GET() {
  const cached = getCached<unknown>(HEALTH_CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { status: 200 });
  }

  const checks: Record<string, ServiceStatus> = {};

  // Check Alpaca
  try {
    const res = await fetch(`${process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
      },
    });
    checks.alpaca = res.ok ? 'ok' : 'error';
  } catch {
    checks.alpaca = process.env.ALPACA_API_KEY ? 'error' : 'unconfigured';
  }

  // Check FMP — probe the same /stable endpoint the rest of the app uses.
  // Legacy /api/v3/quote/ returns 403 on newer FMP plans, producing false "error".
  try {
    if (process.env.FMP_API_KEY) {
      const res = await fetch(
        `https://financialmodelingprep.com/stable/quote?symbol=%5EGSPC&apikey=${process.env.FMP_API_KEY}`,
        { signal: AbortSignal.timeout(4000) },
      );
      checks.fmp = res.ok ? 'ok' : 'error';
    } else {
      checks.fmp = 'unconfigured';
    }
  } catch {
    checks.fmp = 'error';
  }

  // Check Supabase — probe the PostgREST root, which returns 200 regardless of schema
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      checks.supabase = 'unconfigured';
    } else {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(4000),
      });
      checks.supabase = res.ok ? 'ok' : 'error';
    }
  } catch {
    checks.supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'error' : 'unconfigured';
  }

  // Check Claude — verify the API key actually authenticates
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      checks.claude = 'unconfigured';
    } else {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(4000),
      });
      checks.claude = res.ok ? 'ok' : 'error';
    }
  } catch {
    checks.claude = process.env.ANTHROPIC_API_KEY ? 'error' : 'unconfigured';
  }

  // Check Phase 1 APIs (key presence)
  checks.finnhub = process.env.FINNHUB_API_KEY ? 'ok' : 'unconfigured';
  checks.fred = process.env.FRED_API_KEY ? 'ok' : 'unconfigured';
  checks.polygon = process.env.POLYGON_API_KEY ? 'ok' : 'unconfigured';
  checks.quiver = process.env.QUIVER_API_KEY ? 'ok' : 'unconfigured';

  // Check Phase 2 APIs
  checks.newsapi = process.env.NEWSAPI_KEY ? 'ok' : 'unconfigured';
  checks.openweather = process.env.OPENWEATHER_API_KEY ? 'ok' : 'unconfigured';
  checks.attom = process.env.ATTOM_API_KEY ? 'ok' : 'unconfigured';

  // Circuit breaker status — mark degraded if any are open
  const circuits = getAllCircuitStats();
  for (const [name, stats] of Object.entries(circuits)) {
    if (stats.state === 'OPEN' && checks[name] === 'ok') {
      checks[name] = 'degraded';
    }
  }

  const envCheck = checkEnvironment();
  const rateLimits = getAllRateLimitStats();

  const okCount = Object.values(checks).filter(v => v === 'ok').length;
  const errorCount = Object.values(checks).filter(v => v === 'error').length;
  const totalChecked = Object.values(checks).filter(v => v !== 'unconfigured').length;

  let status: 'healthy' | 'degraded' | 'critical';
  if (errorCount === 0) status = 'healthy';
  else if (errorCount <= 2) status = 'degraded';
  else status = 'critical';

  // P0-3: do NOT include `recentApiCalls` — the in-memory ring buffer in
  // api-client.ts captures upstream error text (provider names, HTTP bodies,
  // stack-trace fragments). Sentry already has this data; the browser
  // doesn't need it. The dashboard's Connections widget only reads
  // `services` and `summary`, so dropping the buffer is invisible to UX.
  const payload = {
    status,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    services: checks,
    summary: {
      total: Object.keys(checks).length,
      ok: okCount,
      errors: errorCount,
      unconfigured: Object.values(checks).filter(v => v === 'unconfigured').length,
      configured: totalChecked,
    },
    rateLimits,
    circuits,
    environment: {
      valid: envCheck.valid,
      warnings: envCheck.warnings,
      missingRequired: envCheck.missing.filter(m => m.required).length,
    },
    uptime: process.uptime(),
  };

  setCache(HEALTH_CACHE_KEY, payload, HEALTH_CACHE_TTL_MS);
  return NextResponse.json(payload, { status: status === 'critical' ? 503 : 200 });
}
