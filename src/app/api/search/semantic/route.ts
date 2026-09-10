import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { semanticSearch, type DocType } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DOC_TYPES: DocType[] = ['filing', 'transcript', 'journal', 'news', 'research', 'debate'];

// POST /api/search/semantic  body: { query, match_count?, filter_ticker?, filter_doc_type? }
// GET  /api/search/semantic?q=...&type=...&ticker=...&limit=...  (convenience)
type SearchParams = {
  query?: string;
  match_count?: number;
  filter_ticker?: string;
  filter_doc_type?: string;
};

/**
 * Rate limit + embeddings-config gate. Runs BEFORE either verb touches the
 * request body, so a rate-limited caller gets 429 even when the body is
 * malformed — matching the pre-refactor ordering, where POST rate-limited
 * first and parsed second. Returns a response to short-circuit, or null.
 */
async function preflight(req: NextRequest): Promise<NextResponse | null> {
  // P0-6: embeddings call per query, durable session-keyed.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('semantic-search', key, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests', hits: [] }, { status: 429 });

  const cfg = isEmbeddingConfigured();
  if (!cfg.ready) {
    return NextResponse.json(
      { error: 'Embeddings unconfigured — set VOYAGE_API_KEY or OPENAI_API_KEY', hits: [] },
      { status: 503 },
    );
  }
  return null;
}

/** Shared body handler. preflight() has already passed by the time this runs. */
async function handleSearch(body: SearchParams) {
  const cfg = isEmbeddingConfigured();

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

export async function POST(req: NextRequest) {
  const gate = await preflight(req);
  if (gate) return gate;

  let body: SearchParams;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad JSON', hits: [] }, { status: 400 });
  }
  return handleSearch(body);
}

export async function GET(req: NextRequest) {
  const gate = await preflight(req);
  if (gate) return gate;

  const sp = req.nextUrl.searchParams;
  // `?limit=` (empty) must fall through to the default, not to Number('') === 0,
  // which the clamp below would floor to 1. Matches the old `sp.get(..) ? .. : undefined`.
  const rawLimit = sp.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
  return handleSearch({
    query: sp.get('q') ?? '',
    match_count: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    filter_doc_type: sp.get('type') ?? undefined,
    filter_ticker: sp.get('ticker') ?? undefined,
  });
}
