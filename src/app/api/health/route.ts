import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, 'ok' | 'error' | 'unconfigured'> = {};

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

  // Check FMP
  checks.fmp = process.env.FMP_API_KEY ? 'ok' : 'unconfigured';

  // Check Supabase
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    const { error } = await supabase.from('settings').select('id').limit(1);
    checks.supabase = error ? 'error' : 'ok';
  } catch {
    checks.supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'error' : 'unconfigured';
  }

  // Check Claude
  checks.claude = process.env.ANTHROPIC_API_KEY ? 'ok' : 'unconfigured';

  const allOk = Object.values(checks).every(v => v !== 'error');

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    services: checks,
    uptime: process.uptime(),
  }, { status: allOk ? 200 : 503 });
}
