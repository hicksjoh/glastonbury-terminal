import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestSnapshots, takePredictionSnapshot } from '@/lib/prediction-markets';
import { getCached, setCache } from '@/lib/server-cache';

// F8 — Polymarket + Kalshi event-odds overlay.
//
// The heavy lifting (fetching markets, computing 24h deltas, persisting
// snapshots) already lives in src/lib/prediction-markets.ts and runs on
// a daily cron at /api/cron/prediction-snapshot. This route exposes the
// most recent snapshot per ticker to the frontend + MCP server.
//
// GET /api/prediction-markets                 - cached read (5 min TTL)
// GET /api/prediction-markets?refresh=true    - force a new snapshot cycle
//                                               and return it

const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const cacheKey = 'prediction-markets:latest';

  if (!refresh) {
    const cached = getCached<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  let refreshResult: { inserted: number; deltas: unknown[] } | null = null;
  if (refresh) {
    try {
      refreshResult = await takePredictionSnapshot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'snapshot failed';
      return NextResponse.json({
        markets: [],
        summary: { count: 0, biggestMove: null },
        error: msg,
        source: 'polymarket+kalshi',
      }, { status: 502 });
    }
  }

  try {
    const rows = await fetchLatestSnapshots();
    const biggestMove = rows
      .filter((r) => typeof r.delta_24h === 'number')
      .sort((a, b) => Math.abs((b.delta_24h ?? 0)) - Math.abs((a.delta_24h ?? 0)))[0];

    const payload = {
      markets: rows.map((r) => ({
        source: r.source,
        ticker: r.market_ticker,
        name: r.market_name,
        yesPrice: r.yes_price,
        noPrice: r.no_price,
        volume24h: r.volume_24h,
        delta24h: r.delta_24h,
        category: r.category,
        snapshotAt: r.snapshot_at,
      })),
      summary: {
        count: rows.length,
        biggestMove: biggestMove
          ? {
              ticker: biggestMove.market_ticker,
              name: biggestMove.market_name,
              delta24h: biggestMove.delta_24h,
              yesPrice: biggestMove.yes_price,
            }
          : null,
      },
      ...(refreshResult ? { refresh: { inserted: refreshResult.inserted } } : {}),
      source: 'polymarket+kalshi',
    };

    if (!refresh) setCache(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      markets: [],
      summary: { count: 0, biggestMove: null },
      error: msg,
      source: 'polymarket+kalshi',
    }, { status: 500 });
  }
}
