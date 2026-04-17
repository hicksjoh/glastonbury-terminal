import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { generateMemo } from '@/lib/earnings-engine';
import { indexDoc } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/earnings/live/session/[id]/end — mark completed + generate memo
export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const { allowed } = rateLimit('earnings-end', 10, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const sessionId = ctx.params.id;
  const t0 = Date.now();

  try {
    const sb = createServiceClient();
    const [sessRes, chunksRes] = await Promise.all([
      sb.from('earnings_sessions').select('ticker, quarter, status').eq('id', sessionId).single(),
      sb.from('earnings_transcript_chunks')
        .select('seq, speaker, chunk_text')
        .eq('session_id', sessionId)
        .order('seq', { ascending: true })
        .limit(2000),
    ]);
    if (sessRes.error || !sessRes.data) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const session = sessRes.data as unknown as { ticker: string; quarter: string | null; status: string };
    const chunks = (chunksRes.data as unknown as { seq: number; speaker: string | null; chunk_text: string }[]) ?? [];
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No transcript to summarize' }, { status: 400 });
    }

    const transcriptText = chunks.map(c => `${c.speaker ?? ''}: ${c.chunk_text}`.trim()).join('\n');
    const memo = await generateMemo({
      ticker: session.ticker,
      quarter: session.quarter,
      transcriptText,
    });

    // Persist memo
    const { error: memoErr } = await sb.from('earnings_memos').insert({
      session_id: sessionId,
      memo_text: memo.memo_markdown,
      keisha_take: memo.keisha_take,
      guidance_delta: memo.guidance_delta,
      key_quotes: memo.key_quotes,
    });

    // Mark session complete
    await sb.from('earnings_sessions').update({
      status: 'completed',
      ended_at: new Date().toISOString(),
    }).eq('id', sessionId);

    // Append to journal (best-effort — table may not exist yet)
    try {
      await sb.from('trade_journal').insert({
        ticker: session.ticker,
        symbol: session.ticker,
        direction: 'note',
        strategy: 'earnings_memo',
        entry_date: new Date().toISOString().slice(0, 10),
        entry_price: 0,
        quantity: 0,
        notes: `Earnings memo (${session.quarter ?? 'live'}):\n\n${memo.keisha_take}\n\nGuidance: ${memo.guidance_delta}`,
      });
    } catch { /* journal append is best-effort */ }

    // Auto-index the transcript + memo into doc_chunks for semantic search (Phase 6).
    // Best-effort — if embeddings aren't configured we silently skip.
    if (isEmbeddingConfigured().ready) {
      const transcriptHeader = `Earnings transcript — ${session.ticker}${session.quarter ? ` ${session.quarter}` : ''}\n\n`;
      indexDoc({
        doc_type: 'transcript',
        source_id: sessionId,
        content: transcriptHeader + transcriptText,
        ticker: session.ticker,
        metadata: { quarter: session.quarter },
      }).catch(() => {});
      indexDoc({
        doc_type: 'research',
        source_id: `earnings-memo:${sessionId}`,
        content: `Earnings memo — ${session.ticker}${session.quarter ? ` ${session.quarter}` : ''}\nGuidance: ${memo.guidance_delta}\n\nKeisha's take: ${memo.keisha_take}\n\n${memo.memo_markdown}`,
        ticker: session.ticker,
        metadata: { quarter: session.quarter, guidance_delta: memo.guidance_delta, source: 'earnings_memo' },
      }).catch(() => {});
    }

    const latency = Date.now() - t0;
    return NextResponse.json({
      memo,
      latency_ms: latency,
      memoWriteError: memoErr?.message ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
