import { NextRequest, NextResponse } from 'next/server';
import { WHALES, findWhale } from '@/lib/whales/roster';
import { list13FHR, fetchHoldings, diffHoldings } from '@/lib/whales/edgar';
import { getCached, setCache } from '@/lib/server-cache';

// F6 — 13F whale mirror via SEC EDGAR
//
// GET /api/whales              → roster with latest 13F-HR filing metadata per whale
// GET /api/whales?slug=xxx     → full detail: latest filing + holdings (top 25 by value)
// GET /api/whales?slug=xxx&diff=true
//                              → holdings + diff vs prior quarter (new buys, sold, ±)
//
// Cached 6h per key — 13F filings are quarterly so aggressive caching is fine.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  const wantDiff = req.nextUrl.searchParams.get('diff') === 'true';

  // ─── List mode ──────────────────────────────────────────────────
  if (!slug) {
    const cacheKey = 'whales:roster';
    const cached = getCached<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const rosterWithLatest = await Promise.all(
      WHALES.map(async (whale) => {
        const filings = await list13FHR(whale.cik, 1);
        return {
          ...whale,
          latestFiling: filings[0] ?? null,
        };
      }),
    );

    const payload = {
      whales: rosterWithLatest,
      source: 'sec-edgar',
      count: rosterWithLatest.length,
    };
    setCache(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  }

  // ─── Detail mode ────────────────────────────────────────────────
  const whale = findWhale(slug);
  if (!whale) {
    return NextResponse.json({ error: `Unknown whale slug: ${slug}` }, { status: 404 });
  }

  const cacheKey = `whales:detail:${slug}:${wantDiff ? 'diff' : 'plain'}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const filings = await list13FHR(whale.cik, wantDiff ? 2 : 1);
    if (filings.length === 0) {
      return NextResponse.json({ whale, filings: [], holdings: [] });
    }

    const latestHoldings = await fetchHoldings(filings[0].infoTableUrl);

    // Top 25 by value
    const topHoldings = [...latestHoldings]
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 25);

    let diff: ReturnType<typeof diffHoldings> | null = null;
    if (wantDiff && filings.length >= 2) {
      const priorHoldings = await fetchHoldings(filings[1].infoTableUrl);
      diff = diffHoldings(priorHoldings, latestHoldings);
    }

    const totalValueUsd = latestHoldings.reduce((s, h) => s + h.valueUsd, 0);

    const payload = {
      whale,
      filings,
      totalValueUsd,
      holdingsCount: latestHoldings.length,
      topHoldings,
      diff,
      source: 'sec-edgar',
    };
    setCache(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg, whale }, { status: 500 });
  }
}
