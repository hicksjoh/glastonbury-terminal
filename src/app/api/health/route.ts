import { NextResponse } from 'next/server';
import { getAllRateLimitStats } from '@/lib/rate-limiter';
import { getAllCircuitStats } from '@/lib/circuit-breaker';
import { getRecentApiLogs } from '@/lib/api-client';
import { checkEnvironment } from '@/lib/env-check';

type ServiceStatus = 'ok' | 'error' | 'unconfigured' | 'degraded';

export async function GET() {
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

  // Check FMP (verify with a real call)
  try {
    if (process.env.FMP_API_KEY) {
      const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/%5EGSPC?apikey=${process.env.FMP_API_KEY}`);
      checks.fmp = res.ok ? 'ok' : 'error';
    } else {
      checks.fmp = 'unconfigured';
    }
  } catch {
    checks.fmp = 'error';
  }

  // Check Supabase
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    );
    const { error } = await supabase.from('settings').select('id').limit(1);
    checks.supabase = error ? 'error' : 'ok';
  } catch {
    checks.supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'error' : 'unconfigured';
  }

  // Check Claude
  checks.claude = process.env.ANTHROPIC_API_KEY ? 'ok' : 'unconfigured';

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
  const recentLogs = getRecentApiLogs(20);

  const okCount = Object.values(checks).filter(v => v === 'ok').length;
  const errorCount = Object.values(checks).filter(v => v === 'error').length;
  const totalChecked = Object.values(checks).filter(v => v !== 'unconfigured').length;

  let status: 'healthy' | 'degraded' | 'critical';
  if (errorCount === 0) status = 'healthy';
  else if (errorCount <= 2) status = 'degraded';
  else status = 'critical';

  return NextResponse.json({
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
    recentApiCalls: recentLogs,
    environment: {
      valid: envCheck.valid,
      warnings: envCheck.warnings,
      missingRequired: envCheck.missing.filter(m => m.required).length,
    },
    uptime: process.uptime(),
  }, { status: status === 'critical' ? 503 : 200 });
}
