import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(10);

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('audit-log', RATE.READ, GET_impl);
