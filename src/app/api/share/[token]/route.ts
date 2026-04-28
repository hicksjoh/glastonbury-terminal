import { NextRequest, NextResponse } from 'next/server';
import { consumeShareToken } from '@/lib/share/tokens';
import { loadWealthSnapshot } from '@/lib/hedge/rsu-analyzer';
import { rateLimit } from '@/lib/rate-limit';

// F17 — Public read endpoint for tokenized shared dashboards.
//
// This is the ONE route in the entire app that does NOT require gt-auth.
// The token itself is the auth credential. Anyone with the token can read
// the view, nothing else. Tokens are 32 hex chars (16 bytes of crypto-
// random), expire after the TTL chosen at create time, and can be
// revoked instantly via DELETE /api/share?token=.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Generic per-token rate limit so a leaked token can't be used to DDoS
  // the underlying snapshot lookups.
  const { allowed } = rateLimit(`share-read:${token}`, 30, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const t = await consumeShareToken(token);
  if (!t) {
    return NextResponse.json(
      { error: 'Token is invalid, expired, or revoked' },
      { status: 404 },
    );
  }

  // If we have a frozen snapshot, serve that. Otherwise compute live.
  let payload: unknown = t.snapshot;
  if (!payload) {
    if (t.viewType === 'net_worth' || t.viewType === 'wealth_summary') {
      const wealth = await loadWealthSnapshot();
      const liquidNetWorth = wealth.rsu + wealth.brokerage + wealth.cash;
      const breakdownPct = wealth.total > 0
        ? {
          rsu: Math.round((wealth.rsu / wealth.total) * 1000) / 10,
          franchise: Math.round((wealth.franchise / wealth.total) * 1000) / 10,
          realEstate: Math.round((wealth.realEstate / wealth.total) * 1000) / 10,
          brokerage: Math.round((wealth.brokerage / wealth.total) * 1000) / 10,
          cash: Math.round((wealth.cash / wealth.total) * 1000) / 10,
        }
        : null;

      if (t.viewType === 'net_worth') {
        // Minimal: total + liquid only.
        payload = { total: wealth.total, liquid: liquidNetWorth };
      } else {
        // wealth_summary: full breakdown, no transactional detail.
        payload = { ...wealth, liquidNetWorth, breakdownPct };
      }
    }
  }

  return NextResponse.json({
    viewType: t.viewType,
    label: t.label,
    payload,
    meta: {
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      viewCount: t.viewCount,
    },
  });
}
