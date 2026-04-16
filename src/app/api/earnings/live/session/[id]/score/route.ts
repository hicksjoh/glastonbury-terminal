import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { scorePassages } from '@/lib/earnings-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/earnings/live/session/[id]/score
// Finds up to N unscored chunks, batches them through Haiku, writes results back.
// Idempotent — safe to call every 30s from the client.
export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const { allowed } = rateLimit('earnings-score', 60, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const sessionId = ctx.params.id;
  const BATCH_SIZE = 20;

  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from('earnings_transcript_chunks')
      .select('id, chunk_text')
      .eq('session_id', sessionId)
      .is('sentiment_score', null)
      .order('seq', { ascending: true })
      .limit(BATCH_SIZE);
    if (error) return NextResponse.json({ error: error.message, scored: 0 }, { status: 500 });
    const rows = (data as unknown as { id: string; chunk_text: string }[]) ?? [];
    if (rows.length === 0) return NextResponse.json({ scored: 0 });

    const passages = rows.map(r => r.chunk_text);
    const scored = await scorePassages(passages);

    // Write back individually (Supabase client doesn't have bulk-update-by-id).
    await Promise.all(
      rows.map((row, i) =>
        sb.from('earnings_transcript_chunks')
          .update({ sentiment_score: scored[i]?.score ?? 0, sentiment_tags: scored[i]?.tags ?? [] })
          .eq('id', row.id)
      ),
    );

    return NextResponse.json({ scored: rows.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, scored: 0 }, { status: 500 });
  }
}
