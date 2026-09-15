import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GET_impl(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const ticker = req.nextUrl.searchParams.get('ticker');
  const sb = createServiceClient();
  let q = sb.from('trade_debates')
    .select('id, ticker, proposed_trade, moderator_verdict, moderator_confidence, key_tension_points, wes_decision, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (ticker) q = q.eq('ticker', ticker.toUpperCase());
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, debates: [] }, { status: 500 });
  return NextResponse.json({ debates: data ?? [] });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('debate/list', RATE.EXPENSIVE, GET_impl);
