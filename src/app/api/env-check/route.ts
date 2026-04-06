import { NextResponse } from 'next/server';

export async function GET() {
  const vars: Record<string, boolean> = {
    ALPACA_API_KEY: !!process.env.ALPACA_API_KEY,
    ALPACA_SECRET_KEY: !!process.env.ALPACA_SECRET_KEY,
    ALPACA_PAPER: !!process.env.ALPACA_PAPER,
    FMP_API_KEY: !!process.env.FMP_API_KEY,
    SUPABASE_URL: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_SERVICE_KEY: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY,
  };

  const isPaper = process.env.ALPACA_PAPER === 'true' ||
    (process.env.ALPACA_API_URL || '').includes('paper');

  return NextResponse.json({ vars, isPaper });
}
