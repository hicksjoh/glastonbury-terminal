import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/earnings/live/session  — list sessions (newest first, 20 rows)
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const status = req.nextUrl.searchParams.get('status');
  try {
    const sb = createServiceClient();
    let q = sb.from('earnings_sessions')
      .select('id, ticker, call_date, quarter, source_url, status, started_at, ended_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message, sessions: [] }, { status: 500 });
    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, sessions: [] }, { status: 500 });
  }
}

// POST /api/earnings/live/session  — create a new session
export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('earnings-session-create', 20, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: { ticker?: string; call_date?: string; quarter?: string; source_url?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const ticker = (body.ticker ?? '').trim().toUpperCase();
  if (!/^[A-Z.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }
  const callDate = body.call_date || new Date().toISOString().slice(0, 10);

  try {
    const sb = createServiceClient();
    const { data, error } = await sb.from('earnings_sessions').insert({
      user_id: 'wes',
      ticker,
      call_date: callDate,
      quarter: body.quarter ?? null,
      source_url: body.source_url ?? null,
      status: 'live',
      started_at: new Date().toISOString(),
    }).select('id, ticker, call_date, quarter, status').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ session: data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
