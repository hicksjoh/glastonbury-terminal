import { NextRequest, NextResponse } from 'next/server';
import { searchAssets, getSnapshot } from '@/lib/alpaca';
import { sanitizeSymbol } from '@/lib/sanitize';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

async function GET_impl(req: NextRequest) {
  try {
    const rawQuery = req.nextUrl.searchParams.get('q');
    const query = rawQuery ? sanitizeSymbol(rawQuery) : null;
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '8');

    if (!query || query.length < 1) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchAssets(query, limit);

    if (query.length <= 5 && results.length > 0 && results[0].symbol === query.toUpperCase()) {
      try {
        const snapshot = await getSnapshot(results[0].symbol);
        results[0].price = snapshot.latestTrade?.p || null;
        results[0].prevClose = snapshot.prevDailyBar?.c || null;
        results[0].change = results[0].price && results[0].prevClose
          ? ((results[0].price - results[0].prevClose) / results[0].prevClose * 100).toFixed(2)
          : null;
      } catch {
        // Snapshot not available
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed';
    return NextResponse.json({ error: msg, results: [] }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('alpaca/search', RATE.UPSTREAM, GET_impl);
