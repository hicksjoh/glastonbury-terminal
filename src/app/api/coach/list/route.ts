import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GET_impl(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('coach_reviews')
    .select('*')
    .eq('user_id', userId)
    .order('week_of', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message, reviews: [] }, { status: 500 });
  return NextResponse.json({ reviews: data ?? [] });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('coach/list', RATE.EXPENSIVE, GET_impl);
