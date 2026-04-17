'use client';

import { useCallback, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_SEMANTIC_SEARCH === 'true';

type DocType = 'filing' | 'transcript' | 'journal' | 'news' | 'research' | 'debate';

type Hit = {
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

const DOC_TYPE_COLOR: Record<DocType, string> = {
  journal: '#f0c674',
  research: '#8a5cf6',
  transcript: '#4ade80',
  filing: '#22d3ee',
  news: '#a78bfa',
  debate: '#f87171',
};

const EXAMPLE_QUERIES = [
  'Journal entries where I mentioned FOMO',
  'Companies guided down on margins',
  'Earnings calls talking about AI monetization',
  'Trades where I sized up too quickly',
  'Management hedging language',
];

function SearchInner() {
  const [query, setQuery] = useState('');
  const [docType, setDocType] = useState<DocType | ''>('');
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const search = useCallback(async (q?: string) => {
    const actualQuery = (q ?? query).trim();
    if (!actualQuery) return;
    setQuery(actualQuery);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/search/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: actualQuery,
          filter_doc_type: docType || undefined,
          filter_ticker: ticker.trim() || undefined,
          match_count: 20,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setHits([]);
      } else {
        setHits(body.hits ?? []);
        setProvider(body.provider ?? null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, docType, ticker]);

  const runBackfill = useCallback(async () => {
    if (backfilling) return;
    if (!confirm('Re-index all trade_journal rows into doc_chunks?')) return;
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const res = await fetch('/api/search/backfill-journal', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) setBackfillMsg(`Error: ${body.error}`);
      else setBackfillMsg(`Indexed ${body.indexed}/${body.total} journal entries · ${body.chunks} chunks via ${body.provider}`);
    } catch (err) {
      setBackfillMsg(`Error: ${(err as Error).message}`);
    } finally {
      setBackfilling(false);
    }
  }, [backfilling]);

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>Semantic Search</h1>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
            Embedded search across your journal, earnings transcripts + memos, deep-research memos, filings, and news.
          </p>
        </div>

        {/* Search box */}
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) search(); }}
              placeholder="What are you looking for?"
              disabled={loading}
              style={{
                flex: 1, padding: '12px 14px', fontSize: 14,
                background: '#0a0a1a', color: '#e8e8e8',
                border: '1px solid #333', borderRadius: 8,
              }}
            />
            <button
              onClick={() => search()}
              disabled={loading || !query.trim()}
              style={{
                padding: '12px 20px', fontSize: 14, fontWeight: 700,
                background: loading ? 'rgba(138,92,246,0.2)' : 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
                border: 'none', borderRadius: 8, color: '#fff',
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading || !query.trim() ? 0.5 : 1,
              }}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: '#888' }}>Type:</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value as DocType | '')}
              style={{ padding: '6px 10px', fontSize: 12, background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333', borderRadius: 6 }}
            >
              <option value="">All</option>
              <option value="journal">Journal</option>
              <option value="transcript">Transcripts</option>
              <option value="research">Research</option>
              <option value="filing">Filings</option>
              <option value="news">News</option>
              <option value="debate">Debates</option>
            </select>
            <label style={{ fontSize: 11, color: '#888' }}>Ticker:</label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="(any)"
              style={{ width: 80, padding: '6px 8px', fontSize: 12, background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace" }}
            />
            {provider && !loading && (
              <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>via {provider}</span>
            )}
            <button
              onClick={runBackfill}
              disabled={backfilling}
              style={{ padding: '6px 10px', fontSize: 11, background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: backfilling ? 'wait' : 'pointer' }}
            >
              {backfilling ? 'Backfilling…' : 'Backfill journal'}
            </button>
          </div>
          {backfillMsg && (
            <div style={{ marginTop: 8, fontSize: 11, color: backfillMsg.startsWith('Error') ? '#f87171' : '#4ade80' }}>
              {backfillMsg}
            </div>
          )}
        </div>

        {/* Example queries */}
        {hits.length === 0 && !loading && !error && (
          <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.08)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Try
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EXAMPLE_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => search(q)}
                  style={{
                    padding: '6px 12px', fontSize: 12,
                    background: 'rgba(138,92,246,0.08)', border: '1px solid #8a5cf6',
                    borderRadius: 999, color: '#8a5cf6', cursor: 'pointer',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Results */}
        {hits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {hits.length} results
            </div>
            {hits.map(h => (
              <div key={h.id} style={{
                padding: 14, background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${DOC_TYPE_COLOR[h.doc_type]}30`, borderRadius: 10,
                borderLeft: `3px solid ${DOC_TYPE_COLOR[h.doc_type]}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 }}>
                  <span style={{
                    padding: '1px 8px', borderRadius: 4,
                    background: `${DOC_TYPE_COLOR[h.doc_type]}20`, color: DOC_TYPE_COLOR[h.doc_type],
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {h.doc_type}
                  </span>
                  {h.ticker && (
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#e8e8e8' }}>
                      {h.ticker}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', color: '#888' }}>
                    sim {(h.similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#d0d0e0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {h.chunk_text}
                </div>
                {(h.source_url || h.source_id) && (
                  <div style={{ marginTop: 8, fontSize: 10, color: '#555' }}>
                    {h.source_url ? (
                      <a href={h.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#8a5cf6' }}>
                        {h.source_url}
                      </a>
                    ) : (
                      <span>source: {h.source_id}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DisabledNotice() {
  return (
    <AppShell>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ maxWidth: 520, padding: 24, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.2)', borderRadius: 12, textAlign: 'center' }}>
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18 }}>Semantic search disabled</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            Set <code style={{ color: '#f0c674' }}>NEXT_PUBLIC_FEATURE_SEMANTIC_SEARCH=true</code> and restart.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return FEATURE ? <SearchInner /> : <DisabledNotice />;
}
