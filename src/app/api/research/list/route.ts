import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'research/list' });
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
    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'research/list', user_id: userId });
      log.error({ err: error.message, sentry_event_id: eventId }, 'research list query failed');
      // p6-13: don't echo raw Supabase error.
      return NextResponse.json({ error: 'Failed to list memos', sentry_event_id: eventId, memos: [] }, { status: 500 });
    }
    return NextResponse.json({ memos: data ?? [] });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'research/list', user_id: userId });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'research list threw');
    return NextResponse.json({ error: 'Failed to list memos', sentry_event_id: eventId, memos: [] }, { status: 500 });
  }
}
