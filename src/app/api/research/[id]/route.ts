import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const { log, request_id } = loggerFor(req, { route: 'research/[id]' });
  try {
    const sb = createServiceClient();
    const { data, error } = await sb.from('deep_research_memos')
      .select('*')
      .eq('id', ctx.params.id)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ memo: data });
  } catch (err) {
    const eventId = captureRouteError(err, { request_id, route: 'research/[id]', memo_id: ctx.params.id });
    log.error({ err: err instanceof Error ? err.message : String(err), sentry_event_id: eventId }, 'research/[id] failed');
    return NextResponse.json({ error: 'Failed to load memo', sentry_event_id: eventId }, { status: 500 });
  }
}
