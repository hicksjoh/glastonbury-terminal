import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/tax/harvest/queue  body: { ids: string[], status: 'queued' | 'rejected' }
// Used by the UI to queue or reject one or more suggestions.
export async function POST(req: NextRequest) {
  let body: { ids?: string[]; status?: 'queued' | 'rejected' };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const ids = (body.ids ?? []).filter(Boolean);
  const status = body.status ?? 'queued';
  if (!['queued', 'rejected'].includes(status)) return NextResponse.json({ error: 'Bad status' }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: 'No ids' }, { status: 400 });

  const sb = createServiceClient();
  const { error } = await sb.from('tax_harvest_suggestions').update({ status }).in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: ids.length, status });
}
