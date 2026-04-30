import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';

const inputSchema = z.object({
  query: z.string().describe('Natural-language search query'),
  filter_doc_type: z.enum(['filing', 'transcript', 'journal', 'news', 'research', 'debate']).optional().describe('Optional filter by document type'),
  filter_ticker: z.string().optional().describe('Optional ticker filter (e.g. AAPL)'),
  match_count: z.number().optional().describe('Number of results to return (default 8, max 20)'),
});

export const semanticSearch: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'semantic_search',
  description: 'Semantic-search Wes\'s indexed documents (journal entries, earnings transcripts, earnings memos, deep research memos, filings, news, debates). Returns top passages with similarity scores and citations. Use this when Wes asks "have I ever traded X before?", "what did management say about margins last quarter?", "journal entries where I mentioned FOMO", or anything that benefits from pulling from his personal corpus. Always use before making a claim about his trading history.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'semantic_search',
    description: 'Semantic-search Wes\'s indexed documents (journal entries, earnings transcripts, earnings memos, deep research memos, filings, news, debates). Returns top passages with similarity scores and citations. Use this when Wes asks "have I ever traded X before?", "what did management say about margins last quarter?", "journal entries where I mentioned FOMO", or anything that benefits from pulling from his personal corpus. Always use before making a claim about his trading history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        filter_doc_type: {
          type: 'string',
          enum: ['filing', 'transcript', 'journal', 'news', 'research', 'debate'],
          description: 'Optional filter by document type',
        },
        filter_ticker: { type: 'string', description: 'Optional ticker filter (e.g. AAPL)' },
        match_count: { type: 'number', description: 'Number of results to return (default 8, max 20)' },
      },
      required: ['query'],
    },
  }),
  async execute(input) {
    const { semanticSearch: semanticSearchFn } = await import('@/lib/doc-indexer');
    const { isEmbeddingConfigured } = await import('@/lib/embeddings');
    if (!isEmbeddingConfigured().ready) {
      return { result: { error: 'Embeddings not configured. Set VOYAGE_API_KEY or OPENAI_API_KEY.' }, success: false };
    }
    const query = String(input.query ?? '').trim();
    if (!query) return { result: { error: 'Missing query' }, success: false };
    const match_count = Math.max(1, Math.min(20, Number(input.match_count ?? 8)));
    const filter_doc_type = typeof input.filter_doc_type === 'string' ? input.filter_doc_type as import('@/lib/doc-indexer').DocType : null;
    const filter_ticker = typeof input.filter_ticker === 'string' ? input.filter_ticker.toUpperCase() : null;
    const { hits } = await semanticSearchFn({ query, match_count, filter_ticker, filter_doc_type });
    return {
      result: {
        query,
        filters: { doc_type: filter_doc_type, ticker: filter_ticker },
        hits: hits.map(h => ({
          doc_type: h.doc_type,
          ticker: h.ticker,
          source_id: h.source_id,
          source_url: h.source_url,
          chunk_text: h.chunk_text.length > 600 ? h.chunk_text.slice(0, 600) + '…' : h.chunk_text,
          similarity: Number(h.similarity.toFixed(3)),
        })),
      },
      success: true,
    };
  },
};
