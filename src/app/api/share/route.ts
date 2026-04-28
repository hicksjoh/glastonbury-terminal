import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  createShareToken,
  listActiveShareTokens,
  revokeShareToken,
  type ShareViewType,
} from '@/lib/share/tokens';

// F17 — Tokenized share-link admin endpoint.
//
// GET    /api/share         - list active tokens (auth required)
// POST   /api/share         - create a new token (auth required)
//                             body: { viewType, label?, ttlHours?, freeze? }
// DELETE /api/share?token=  - revoke (auth required)
//
// Reads (the actual shared view) live at /api/share/[token]/route.ts and
// are the only public path — no gt-auth required there.

const VALID_VIEWS: readonly ShareViewType[] = ['net_worth', 'wealth_summary'];

export async function GET() {
  const tokens = await listActiveShareTokens(50);
  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('share-create', 10, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const body = await req.json();
    const viewType = body.viewType as ShareViewType;
    if (!VALID_VIEWS.includes(viewType)) {
      return NextResponse.json({ error: `viewType must be one of ${VALID_VIEWS.join(', ')}` }, { status: 400 });
    }
    const ttlHours = typeof body.ttlHours === 'number' ? body.ttlHours : undefined;
    const label = typeof body.label === 'string' ? body.label : undefined;

    // Snapshot freezing happens in the per-token route at create time when
    // requested; for now we keep the admin POST simple and let the read
    // route compute live. Future enhancement: body.freeze === true.

    const token = await createShareToken({ viewType, label, ttlHours });
    if (!token) {
      return NextResponse.json({ error: 'Failed to create share token (Supabase unconfigured?)' }, { status: 500 });
    }
    return NextResponse.json({
      token: token.token,
      viewType: token.viewType,
      label: token.label,
      expiresAt: token.expiresAt,
      url: `/share/${token.token}`,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token query param required' }, { status: 400 });
  const ok = await revokeShareToken(token);
  if (!ok) return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
