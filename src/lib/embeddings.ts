/**
 * Embeddings provider abstraction. 1024-dim vectors (matches the pgvector
 * schema from the Phase 0 migration).
 *
 * Primary: Voyage `voyage-finance-2` (finance-tuned, 1024-dim native).
 * Fallback: OpenAI `text-embedding-3-small` with dimensions=1024 (truncated).
 *
 * The primary is chosen by VOYAGE_API_KEY presence. If missing, falls through
 * to OpenAI. Both are free for the traffic Wes will generate.
 */

export const EMBEDDING_DIM = 1024;

type EmbedInputKind = 'query' | 'document';

export type EmbedResult = {
  embeddings: number[][];
  model: string;
  provider: 'voyage' | 'openai';
  token_count: number;
};

function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

// ── Voyage ──────────────────────────────────────────────────────────────────
async function embedVoyage(texts: string[], kind: EmbedInputKind): Promise<EmbedResult> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  const model = process.env.EMBEDDING_MODEL || 'voyage-finance-2';
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: texts,
      model,
      input_type: kind === 'query' ? 'query' : 'document',
      output_dimension: EMBEDDING_DIM,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = await res.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
    usage: { total_tokens: number };
  };
  const ordered = [...body.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
  // Voyage returns already-1024-dim but cosine-sim benefits from normalization anyway.
  return {
    embeddings: ordered.map(normalizeVector),
    model: body.model,
    provider: 'voyage',
    token_count: body.usage?.total_tokens ?? 0,
  };
}

// ── OpenAI ──────────────────────────────────────────────────────────────────
async function embedOpenAI(texts: string[]): Promise<EmbedResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const model = 'text-embedding-3-small';
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: texts,
      dimensions: EMBEDDING_DIM,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = await res.json() as {
    data: Array<{ embedding: number[]; index: number }>;
    model: string;
    usage: { total_tokens: number };
  };
  const ordered = [...body.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
  return {
    embeddings: ordered.map(normalizeVector),
    model: body.model,
    provider: 'openai',
    token_count: body.usage?.total_tokens ?? 0,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function embedBatch(texts: string[], kind: EmbedInputKind = 'document'): Promise<EmbedResult> {
  if (texts.length === 0) return { embeddings: [], model: 'none', provider: 'voyage', token_count: 0 };
  if (process.env.VOYAGE_API_KEY) {
    try { return await embedVoyage(texts, kind); }
    catch (err) {
      if (!process.env.OPENAI_API_KEY) throw err;
      // fallthrough
    }
  }
  if (process.env.OPENAI_API_KEY) return embedOpenAI(texts);
  throw new Error('No embedding provider configured. Set VOYAGE_API_KEY or OPENAI_API_KEY.');
}

export async function embedOne(text: string, kind: EmbedInputKind = 'document'): Promise<number[]> {
  const r = await embedBatch([text], kind);
  return r.embeddings[0] ?? [];
}

// Format an embedding array as a pgvector literal string (required for RPC calls via PostgREST).
export function formatPgvector(v: number[]): string {
  return `[${v.join(',')}]`;
}

export function isEmbeddingConfigured(): { provider: 'voyage' | 'openai' | null; ready: boolean } {
  if (process.env.VOYAGE_API_KEY) return { provider: 'voyage', ready: true };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', ready: true };
  return { provider: null, ready: false };
}
