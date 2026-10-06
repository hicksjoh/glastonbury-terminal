import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

/**
 * Strategy-vs-SPY benchmark.
 *
 * There is no per-strategy realized-return series to benchmark yet: executions
 * are not attributed to a strategy. This route used to invent one — SPY's
 * return plus a hardcoded per-strategy "alpha" plus seeded noise — and the
 * chart labelled the result "Alpha: +X%" (QA 2026-10-05, blocker 4).
 *
 * Until attributed trade history exists it returns an empty series with a
 * reason, and StrategyBenchmarkChart renders its "No trade history" state.
 */
async function GET_impl(_req: NextRequest) {
  return NextResponse.json({ data: [], reason: 'no_attributed_trade_history' });
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('strategies/benchmark', RATE.WRITE, GET_impl);
