import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GET_impl(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const weekOf = req.nextUrl.searchParams.get('week');

  const sb = createServiceClient();
  let q = sb.from('tax_harvest_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('week_of', { ascending: false })
    .order('unrealized_loss', { ascending: true })
    .limit(50);
  if (weekOf) q = q.eq('week_of', weekOf);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, suggestions: [] }, { status: 500 });
  return NextResponse.json({ suggestions: data ?? [] });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('tax/harvest/list', RATE.READ, GET_impl);
