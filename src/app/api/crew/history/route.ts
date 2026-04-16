import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export async function GET(req: NextRequest) {
  const page = Math.max(0, Number(req.nextUrl.searchParams.get('page') ?? '0'));
  const userId = req.nextUrl.searchParams.get('user') ?? 'wes';

  try {
    const sb = createServiceClient();
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await sb
      .from('crew_runs')
      .select('id, ticker, judge_verdict, judge_confidence, total_cost_usd, total_latency_ms, created_at, completed_at, status', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message, runs: [], page, total: 0 }, { status: 500 });
    }
    return NextResponse.json({
      runs: data ?? [],
      page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
      hasMore: (count ?? 0) > (page + 1) * PAGE_SIZE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, runs: [], page, total: 0 }, { status: 500 });
  }
}
