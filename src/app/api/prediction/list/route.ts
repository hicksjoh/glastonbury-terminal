import { NextResponse } from 'next/server';
import { fetchLatestSnapshots } from '@/lib/prediction-markets';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GET_impl() {
  const snapshots = await fetchLatestSnapshots();
  return NextResponse.json({ snapshots });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('prediction/list', RATE.WRITE, GET_impl);
