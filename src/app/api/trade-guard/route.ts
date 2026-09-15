import { NextRequest, NextResponse } from 'next/server';
import { runTradeGuard } from '@/lib/trade-guard-engine';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

/**
 * Trade Guard API — Pre-trade safety net
 * Delegates to shared engine for behavioral checks, Kelly sizing, and regime detection
 */

async function POST_impl(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, side, quantity, price, winRate, avgWin, avgLoss, wasOnWatchlist } = body;

    const result = await runTradeGuard({
      symbol,
      side,
      quantity,
      price,
      winRate,
      avgWin,
      avgLoss,
      wasOnWatchlist,
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Trade guard error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const POST = withRateLimit('trade-guard', RATE.READ, POST_impl);
