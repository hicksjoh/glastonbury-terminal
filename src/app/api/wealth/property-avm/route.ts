import { NextRequest, NextResponse } from 'next/server';
import { fetchPropertyAvm } from '@/lib/wealth/property-avm';
import { getCached, setCache } from '@/lib/server-cache';
import { rateLimit } from '@/lib/rate-limit';

// F4b — Property AVM via ATTOM (with wealth_assets fallback).
//
// GET /api/wealth/property-avm?address1=<street>&address2=<city,state+zip>
//                          [&assetName=Miami%20Shores]
//
// Defaults route to the Miami Shores property; assetName is used as a
// fallback lookup key against the wealth_assets table when ATTOM is
// unconfigured or returns no AVM. Cached 24h since AVMs update slowly.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { allowed } = rateLimit('property-avm', 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const sp = req.nextUrl.searchParams;
  // Sensible defaults for Wes's primary residence so the dashboard's
  // "Real Estate" tile can call this with no args and still work.
  const address1 = sp.get('address1') ?? '';
  const address2 = sp.get('address2') ?? 'Miami Shores, FL';
  const assetName = sp.get('assetName') ?? 'Miami Shores';

  if (!address1 && !sp.has('address2')) {
    // No specific property requested — return recorded wealth_assets row.
    const cacheKey = `property-avm:fallback:${assetName}`;
    const cached = getCached<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);
    const result = await fetchPropertyAvm('', address2, assetName);
    setCache(cacheKey, result, CACHE_TTL_MS);
    return NextResponse.json(result);
  }

  const cacheKey = `property-avm:${address1}|${address2}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const result = await fetchPropertyAvm(address1, address2, assetName);
  setCache(cacheKey, result, CACHE_TTL_MS);
  return NextResponse.json(result);
}
