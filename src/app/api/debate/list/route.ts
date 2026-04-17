import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const ticker = req.nextUrl.searchParams.get('ticker');
  const sb = createServiceClient();
  let q = sb.from('trade_debates')
    .select('id, ticker, proposed_trade, moderator_verdict, moderator_confidence, key_tension_points, wes_decision, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (ticker) q = q.eq('ticker', ticker.toUpperCase());
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, debates: [] }, { status: 500 });
  return NextResponse.json({ debates: data ?? [] });
}
