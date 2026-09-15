import { NextRequest, NextResponse } from 'next/server';
import { getSymbolSentiment, getMarketSentiment } from '@/lib/sentiment-engine';
import { buildMeta } from '@/lib/api-meta';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

async function GET_impl(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol');

    const { summary, metas } = symbol
      ? await getSymbolSentiment(symbol)
      : await getMarketSentiment();

    const allLive = metas.some(m => m.live);

    return NextResponse.json({
      ...summary,
      _meta: buildMeta({
        source: summary.sources.join('+') || 'none',
        live: allLive,
        cached: metas.some(m => m.cached),
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('sentiment', RATE.UPSTREAM, GET_impl);
