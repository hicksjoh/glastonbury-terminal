import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const weekOf = req.nextUrl.searchParams.get('week');

  const sb = createServiceClient();
  let q = sb.from('tax_harvest_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('week_of', { ascending: false })
    .order('unrealized_loss', { ascending: true })
    .limit(50);
  if (weekOf) q = q.eq('week_of', weekOf);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, suggestions: [] }, { status: 500 });
  return NextResponse.json({ suggestions: data ?? [] });
}
