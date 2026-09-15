import { NextRequest, NextResponse } from 'next/server';
import { getLatestQuote } from '@/lib/alpaca';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
  try {
    const quote = await getLatestQuote(symbol);
    return NextResponse.json(quote);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('alpaca/market-data', RATE.UPSTREAM, GET_impl);
