import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '20')));
  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from('deep_research_memos')
      .select('id, ticker, topic, status, memo_word_count, total_cost_usd, total_runtime_seconds, created_at, completed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message, memos: [] }, { status: 500 });
    return NextResponse.json({ memos: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, memos: [] }, { status: 500 });
  }
}
