import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { indexDoc, type DocType } from '@/lib/doc-indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VALID_DOC_TYPES: DocType[] = ['filing', 'transcript', 'journal', 'news', 'research', 'debate'];

// POST /api/search/index
// Body: { doc_type, source_id, content, ticker?, source_url?, metadata? }
// Indexes (or re-indexes) a single document into doc_chunks.
export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('search-index', 60, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: {
    doc_type?: string;
    source_id?: string;
    content?: string;
    ticker?: string;
    source_url?: string;
    metadata?: Record<string, unknown>;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  if (!body.doc_type || !VALID_DOC_TYPES.includes(body.doc_type as DocType)) {
    return NextResponse.json({ error: `doc_type must be one of: ${VALID_DOC_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!body.source_id?.trim()) return NextResponse.json({ error: 'source_id required' }, { status: 400 });
  if (!body.content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });

  try {
    const result = await indexDoc({
      doc_type: body.doc_type as DocType,
      source_id: body.source_id,
      content: body.content,
      ticker: body.ticker?.toUpperCase() || null,
      source_url: body.source_url || null,
      metadata: body.metadata,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
