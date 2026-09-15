import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { isBriefingStale } from '@/lib/briefing-staleness';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const revalidate = 60; // cache for 60 seconds

// Any briefing older than this is considered stale and will not be served.
// Forces the dashboard to fall back to live-generation via /api/briefing.
const MAX_BRIEFING_AGE_HOURS = 24;

async function GET_impl() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('briefings')
      .select('id, content, market_data_json, portfolio_data_json, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ briefing: null, cached: false });
    }

    if (isBriefingStale(data.created_at, MAX_BRIEFING_AGE_HOURS)) {
      return NextResponse.json({
        briefing: null,
        cached: false,
        stale: true,
        last_created_at: data.created_at,
      });
    }

    return NextResponse.json({
      briefing: data.content,
      cached: true,
      id: data.id,
      created_at: data.created_at,
      market_data: data.market_data_json,
      portfolio_data: data.portfolio_data_json,
    });
  } catch {
    return NextResponse.json({ briefing: null, cached: false });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('briefing/today', RATE.EXPENSIVE, GET_impl);
