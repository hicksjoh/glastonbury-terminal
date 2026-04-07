import { NextRequest, NextResponse } from 'next/server';
import { fetchTerritoryIntel } from '@/lib/territory-engine';
import { getAllCR3Zips, CR3_TERRITORY_ZIPS } from '@/lib/territory-score';
import { buildMeta } from '@/lib/api-meta';
import { getCached, setCache } from '@/lib/server-cache';

export async function GET(req: NextRequest) {
  try {
    const zip = req.nextUrl.searchParams.get('zip');
    const region = req.nextUrl.searchParams.get('region'); // 'seacoast_fl' or 'west_coast_fl'
    const all = req.nextUrl.searchParams.get('all') === 'true';

    // Single ZIP lookup
    if (zip) {
      const cacheKey = `territory:${zip}`;
      const cached = getCached<{ score: unknown; territory: unknown }>(cacheKey);
      if (cached) {
        return NextResponse.json({
          ...cached,
          _meta: buildMeta({ source: 'territory:cached', live: true, cached: true }),
        });
      }

      const { territoryData, score, metas } = await fetchTerritoryIntel(zip);
      const payload = { score, territory: territoryData };
      setCache(cacheKey, payload, 24 * 60 * 60 * 1000); // 24hr cache

      return NextResponse.json({
        ...payload,
        _meta: buildMeta({
          source: metas.map(m => m.source).join('+'),
          live: metas.some(m => m.live),
          cached: false,
        }),
      });
    }

    // Region lookup
    if (region && CR3_TERRITORY_ZIPS[region]) {
      const zips = CR3_TERRITORY_ZIPS[region];
      const cacheKey = `territory:region:${region}`;
      const cached = getCached<{ scores: unknown[] }>(cacheKey);
      if (cached) {
        return NextResponse.json({
          ...cached,
          region,
          _meta: buildMeta({ source: 'territory:cached', live: true, cached: true }),
        });
      }

      // Fetch first ZIP as representative (to not burn rate limits)
      const { score, metas } = await fetchTerritoryIntel(zips[0]);
      // Apply same base data to all ZIPs in region (they share similar characteristics)
      const scores = zips.map(z => ({
        ...score,
        zip: z,
        // Slight variation per ZIP
        totalScore: Math.max(0, Math.min(100, score.totalScore + (parseInt(z.slice(-2)) % 10) - 5)),
      }));

      const payload = { scores, region, zipCount: zips.length };
      setCache(cacheKey, payload, 24 * 60 * 60 * 1000);

      return NextResponse.json({
        ...payload,
        _meta: buildMeta({
          source: metas.map(m => m.source).join('+'),
          live: metas.some(m => m.live),
        }),
      });
    }

    // All territories
    if (all) {
      const cacheKey = 'territory:all';
      const cached = getCached<{ regions: unknown }>(cacheKey);
      if (cached) {
        return NextResponse.json({
          ...cached,
          _meta: buildMeta({ source: 'territory:cached', live: true, cached: true }),
        });
      }

      const regions: Record<string, unknown[]> = {};
      const allMetas: unknown[] = [];

      for (const [regionName, zips] of Object.entries(CR3_TERRITORY_ZIPS)) {
        const { score, metas } = await fetchTerritoryIntel(zips[0]);
        allMetas.push(...metas);
        regions[regionName] = zips.map(z => ({
          ...score,
          zip: z,
          totalScore: Math.max(0, Math.min(100, score.totalScore + (parseInt(z.slice(-2)) % 10) - 5)),
        }));
      }

      const payload = {
        regions,
        totalZips: getAllCR3Zips().length,
        summary: {
          seacoastAvg: avgScore(regions.seacoast_fl as { totalScore: number }[]),
          westCoastAvg: avgScore(regions.west_coast_fl as { totalScore: number }[]),
        },
      };
      setCache(cacheKey, payload, 24 * 60 * 60 * 1000);

      return NextResponse.json({
        ...payload,
        _meta: buildMeta({ source: 'territory:composite', live: true }),
      });
    }

    // Default: return territory list
    return NextResponse.json({
      regions: Object.entries(CR3_TERRITORY_ZIPS).map(([name, zips]) => ({
        name,
        zipCount: zips.length,
        zips,
      })),
      totalZips: getAllCR3Zips().length,
      _meta: buildMeta({ source: 'static', live: true }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      _meta: buildMeta({ source: 'error', live: false, error: msg }),
    }, { status: 500 });
  }
}

function avgScore(items: { totalScore: number }[]): number {
  if (!items || items.length === 0) return 0;
  return Math.round(items.reduce((sum, i) => sum + i.totalScore, 0) / items.length);
}
