import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { indexDoc } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/search/backfill-all
// Indexes every existing deep_research_memo + earnings transcript + earnings memo
// into doc_chunks. One-shot backfill — call it once after configuring an embedding
// provider to seed the corpus.
export async function POST() {
  const { allowed } = rateLimit('backfill-all', 2, 300_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  if (!isEmbeddingConfigured().ready) {
    return NextResponse.json({ error: 'Embeddings unconfigured' }, { status: 503 });
  }

  const sb = createServiceClient();
  const results: Record<string, { indexed: number; failed: number; errors: string[] }> = {
    research: { indexed: 0, failed: 0, errors: [] },
    earnings_transcript: { indexed: 0, failed: 0, errors: [] },
    earnings_memo: { indexed: 0, failed: 0, errors: [] },
  };

  // ── Deep research memos ───────────────────────────────────────────────────
  const { data: memos } = await sb.from('deep_research_memos')
    .select('id, ticker, topic, memo_markdown, memo_word_count, sources_cited, status')
    .eq('status', 'completed');
  const memosRows = (memos as unknown as Array<{ id: string; ticker: string | null; topic: string; memo_markdown: string | null }>) ?? [];
  for (const m of memosRows) {
    if (!m.memo_markdown || m.memo_markdown.trim().length < 100) continue;
    try {
      await indexDoc({
        doc_type: 'research',
        source_id: m.id,
        content: m.memo_markdown,
        ticker: m.ticker,
        source_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/research/${m.id}`,
        metadata: { topic: m.topic, source: 'deep_research_memo' },
      });
      results.research.indexed += 1;
    } catch (err) {
      results.research.failed += 1;
      results.research.errors.push(`${m.id}: ${(err as Error).message}`);
    }
  }

  // ── Earnings transcripts ──────────────────────────────────────────────────
  const { data: sessions } = await sb.from('earnings_sessions')
    .select('id, ticker, quarter, status');
  const sessionRows = (sessions as unknown as Array<{ id: string; ticker: string; quarter: string | null; status: string }>) ?? [];
  for (const s of sessionRows) {
    const { data: chunks } = await sb.from('earnings_transcript_chunks')
      .select('seq, speaker, chunk_text')
      .eq('session_id', s.id).order('seq', { ascending: true });
    const chunkRows = (chunks as unknown as Array<{ seq: number; speaker: string | null; chunk_text: string }>) ?? [];
    if (chunkRows.length === 0) continue;
    const transcript = chunkRows.map(c => `${c.speaker ?? ''}: ${c.chunk_text}`.trim()).join('\n');
    const header = `Earnings transcript — ${s.ticker}${s.quarter ? ` ${s.quarter}` : ''}\n\n`;
    try {
      await indexDoc({
        doc_type: 'transcript',
        source_id: s.id,
        content: header + transcript,
        ticker: s.ticker,
        metadata: { quarter: s.quarter },
      });
      results.earnings_transcript.indexed += 1;
    } catch (err) {
      results.earnings_transcript.failed += 1;
      results.earnings_transcript.errors.push(`${s.id}: ${(err as Error).message}`);
    }

    // Memo for this session
    const { data: memoData } = await sb.from('earnings_memos')
      .select('memo_text, keisha_take, guidance_delta')
      .eq('session_id', s.id).order('created_at', { ascending: false }).limit(1);
    const memoRow = (memoData as unknown as Array<{ memo_text: string; keisha_take: string | null; guidance_delta: string | null }>)?.[0];
    if (memoRow) {
      const content = `Earnings memo — ${s.ticker}${s.quarter ? ` ${s.quarter}` : ''}\nGuidance: ${memoRow.guidance_delta ?? 'unclear'}\n\nKeisha's take: ${memoRow.keisha_take ?? ''}\n\n${memoRow.memo_text}`;
      try {
        await indexDoc({
          doc_type: 'research',
          source_id: `earnings-memo:${s.id}`,
          content,
          ticker: s.ticker,
          metadata: { quarter: s.quarter, guidance_delta: memoRow.guidance_delta, source: 'earnings_memo' },
        });
        results.earnings_memo.indexed += 1;
      } catch (err) {
        results.earnings_memo.failed += 1;
        results.earnings_memo.errors.push(`${s.id}: ${(err as Error).message}`);
      }
    }
  }

  const { count } = await sb.from('doc_chunks').select('*', { count: 'exact', head: true });
  return NextResponse.json({
    ...results,
    doc_chunks_total: count ?? 0,
    provider: isEmbeddingConfigured().provider,
  });
}
