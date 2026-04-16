import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/earnings/live/session/[id] — return session + chunks (since=seq) + memo if any
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  const since = Number(req.nextUrl.searchParams.get('since') ?? '-1');

  try {
    const sb = createServiceClient();
    const [sessRes, chunksRes, memoRes] = await Promise.all([
      sb.from('earnings_sessions').select('*').eq('id', id).single(),
      sb.from('earnings_transcript_chunks')
        .select('id, seq, speaker, chunk_text, sentiment_score, sentiment_tags, created_at')
        .eq('session_id', id)
        .gt('seq', since)
        .order('seq', { ascending: true })
        .limit(1000),
      sb.from('earnings_memos').select('*').eq('session_id', id).order('created_at', { ascending: false }).limit(1),
    ]);
    if (sessRes.error || !sessRes.data) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({
      session: sessRes.data,
      chunks: chunksRes.data ?? [],
      memo: (memoRes.data as unknown as unknown[])?.[0] ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
