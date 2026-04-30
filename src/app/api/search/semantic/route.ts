import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { semanticSearch, type DocType } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DOC_TYPES: DocType[] = ['filing', 'transcript', 'journal', 'news', 'research', 'debate'];

// POST /api/search/semantic  body: { query, match_count?, filter_ticker?, filter_doc_type? }
// GET  /api/search/semantic?q=...&type=...&ticker=...&limit=...  (convenience)
export async function POST(req: NextRequest) {
  // P0-6: embeddings call per query, durable session-keyed.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('semantic-search', key, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const cfg = isEmbeddingConfigured();
  if (!cfg.ready) {
    return NextResponse.json(
      { error: 'Embeddings unconfigured — set VOYAGE_API_KEY or OPENAI_API_KEY', hits: [] },
      { status: 503 },
    );
  }

  let body: { query?: string; match_count?: number; filter_ticker?: string; filter_doc_type?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON', hits: [] }, { status: 400 }); }

  const query = (body.query ?? '').trim();
  if (!query) return NextResponse.json({ error: 'Empty query', hits: [] }, { status: 400 });

  const filter_doc_type = body.filter_doc_type && VALID_DOC_TYPES.includes(body.filter_doc_type as DocType)
    ? (body.filter_doc_type as DocType) : null;
  const filter_ticker = body.filter_ticker?.trim().toUpperCase() || null;
  const match_count = Math.max(1, Math.min(50, body.match_count ?? 20));

  try {
    const result = await semanticSearch({ query, match_count, filter_ticker, filter_doc_type });
    return NextResponse.json({
      hits: result.hits,
      query,
      provider: cfg.provider,
      query_tokens: result.token_count,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, hits: [] }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const synth = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: sp.get('q') ?? '',
      match_count: sp.get('limit') ? Number(sp.get('limit')) : undefined,
      filter_doc_type: sp.get('type') ?? undefined,
      filter_ticker: sp.get('ticker') ?? undefined,
    }),
  });
  return POST(synth as NextRequest);
}
