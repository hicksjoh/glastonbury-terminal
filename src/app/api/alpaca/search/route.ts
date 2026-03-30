import { NextRequest, NextResponse } from 'next/server';
import { searchAssets, getSnapshot } from '@/lib/alpaca';

// GET /api/alpaca/search?q=AAPL&limit=8
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '8');

    if (!query || query.length < 1) {
      return NextResponse.json({ results: [] });
    }

    const results = await searchAssets(query, limit);

    // If we have a short query that looks like an exact symbol, also fetch the snapshot
    if (query.length <= 5 && results.length > 0 && results[0].symbol === query.toUpperCase()) {
      try {
        const snapshot = await getSnapshot(results[0].symbol);
        results[0].price = snapshot.latestTrade?.p || null;
        results[0].prevClose = snapshot.prevDailyBar?.c || null;
        results[0].change = results[0].price && results[0].prevClose
          ? ((results[0].price - results[0].prevClose) / results[0].prevClose * 100).toFixed(2)
          : null;
      } catch {
        // Snapshot not available — not a big deal
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed';
    return NextResponse.json({ error: msg, results: [] }, { status: 500 });
  }
}
