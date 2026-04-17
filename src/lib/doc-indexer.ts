/**
 * Doc-chunk indexer — chunks arbitrary text, embeds via embeddings.ts, and
 * upserts into public.doc_chunks. Used by Phase 6 (semantic search) and by
 * Phase 5/4 auto-indexing hooks.
 */

import { createServiceClient } from '@/lib/supabase';
import { embedBatch, formatPgvector } from '@/lib/embeddings';

export type DocType = 'filing' | 'transcript' | 'journal' | 'news' | 'research' | 'debate';

export type IndexDocArgs = {
  doc_type: DocType;
  ticker?: string | null;
  source_url?: string | null;
  source_id: string;              // Stable id to dedupe chunks (reindexing same doc replaces)
  content: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;             // Target tokens per chunk (approx via chars)
  chunkOverlap?: number;          // Chars of overlap between chunks
};

export type IndexResult = {
  source_id: string;
  inserted: number;
  replaced: number;
  token_count: number;
};

// ── Chunking ────────────────────────────────────────────────────────────────
// Rough heuristic: 1 token ≈ 4 chars for English prose. Target 800 tokens ≈
// 3200 chars. Split on paragraph boundaries first, then sentence boundaries
// within oversized paragraphs. Include a small overlap between chunks to
// preserve context for retrieval.
export function chunkText(
  text: string,
  { chunkSize = 3200, chunkOverlap = 200 }: { chunkSize?: number; chunkOverlap?: number } = {},
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  // Pre-split on blank lines.
  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const p of paragraphs) {
    if (p.length > chunkSize) {
      // Huge paragraph — split on sentence boundaries.
      flush();
      const sentences = p.split(/(?<=[.!?])\s+/);
      let sbuf = '';
      for (const s of sentences) {
        if ((sbuf + ' ' + s).length > chunkSize && sbuf) {
          chunks.push(sbuf.trim());
          // Carry overlap from the end of the previous chunk into the next.
          sbuf = chunkOverlap > 0 ? sbuf.slice(-chunkOverlap) + ' ' + s : s;
        } else {
          sbuf = sbuf ? sbuf + ' ' + s : s;
        }
      }
      if (sbuf.trim()) chunks.push(sbuf.trim());
      continue;
    }

    if ((buf + '\n\n' + p).length > chunkSize && buf) {
      chunks.push(buf.trim());
      buf = chunkOverlap > 0 ? buf.slice(-chunkOverlap) + '\n\n' + p : p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  flush();

  return chunks;
}

// ── Index one document ──────────────────────────────────────────────────────
export async function indexDoc(args: IndexDocArgs): Promise<IndexResult> {
  const sb = createServiceClient();

  // 1. Delete existing chunks for this source so re-index replaces cleanly.
  const { count: existing } = await sb
    .from('doc_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('doc_type', args.doc_type)
    .eq('source_id', args.source_id);
  if ((existing ?? 0) > 0) {
    await sb
      .from('doc_chunks')
      .delete()
      .eq('doc_type', args.doc_type)
      .eq('source_id', args.source_id);
  }

  // 2. Chunk.
  const chunks = chunkText(args.content, {
    chunkSize: args.chunkSize ?? 3200,
    chunkOverlap: args.chunkOverlap ?? 200,
  });
  if (chunks.length === 0) {
    return { source_id: args.source_id, inserted: 0, replaced: existing ?? 0, token_count: 0 };
  }

  // 3. Embed.
  const embedResult = await embedBatch(chunks, 'document');

  // 4. Insert rows — use the pgvector string literal format for the embedding column.
  const rows = chunks.map((chunk_text, i) => ({
    doc_type: args.doc_type,
    ticker: args.ticker ?? null,
    source_url: args.source_url ?? null,
    source_id: args.source_id,
    chunk_text,
    chunk_index: i,
    embedding: formatPgvector(embedResult.embeddings[i] ?? []),
    metadata: {
      ...(args.metadata ?? {}),
      embedding_model: embedResult.model,
      embedding_provider: embedResult.provider,
    },
  }));

  const { error } = await sb.from('doc_chunks').insert(rows);
  if (error) throw new Error(`doc_chunks insert: ${error.message}`);

  return {
    source_id: args.source_id,
    inserted: rows.length,
    replaced: existing ?? 0,
    token_count: embedResult.token_count,
  };
}

// ── Semantic search ─────────────────────────────────────────────────────────
export type SearchHit = {
  id: string;
  doc_type: DocType;
  ticker: string | null;
  source_url: string | null;
  source_id: string;
  chunk_text: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
  similarity: number;
};

export async function semanticSearch(args: {
  query: string;
  match_count?: number;
  filter_ticker?: string | null;
  filter_doc_type?: DocType | null;
}): Promise<{ hits: SearchHit[]; token_count: number }> {
  const sb = createServiceClient();
  const result = await embedBatch([args.query], 'query');
  const vec = result.embeddings[0] ?? [];
  if (vec.length === 0) return { hits: [], token_count: 0 };

  const { data, error } = await sb.rpc('match_doc_chunks', {
    query_embedding: formatPgvector(vec),
    match_count: args.match_count ?? 20,
    filter_ticker: args.filter_ticker ?? null,
    filter_doc_type: args.filter_doc_type ?? null,
  });
  if (error) throw new Error(`match_doc_chunks: ${error.message}`);
  const hits = (data as unknown as SearchHit[]) ?? [];
  return { hits, token_count: result.token_count };
}
