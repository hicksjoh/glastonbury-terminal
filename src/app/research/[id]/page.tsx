'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import MarkdownRenderer from '@/components/MarkdownRenderer';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_DEEP_RESEARCH === 'true';

type Memo = {
  id: string;
  ticker: string | null;
  topic: string;
  prompt: string;
  memo_markdown: string | null;
  memo_word_count: number | null;
  sources_cited: string[] | null;
  total_cost_usd: number | null;
  total_runtime_seconds: number | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  completed_at: string | null;
};

const STATUS_COLOR: Record<Memo['status'], string> = {
  pending: '#888', running: '#f0c674', completed: '#4ade80', failed: '#f87171', cancelled: '#8888a8',
};

function MemoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/${params.id}`);
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Not found'); return; }
      setMemo(body.memo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  // Poll while running
  useEffect(() => {
    if (!memo || (memo.status !== 'running' && memo.status !== 'pending')) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [memo, load]);

  const onPrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  if (loading) return <AppShell><div style={{ padding: 40, color: '#888' }}>Loading…</div></AppShell>;
  if (error || !memo) return <AppShell><div style={{ padding: 40, color: '#f87171' }}>{error ?? 'Not found'}</div></AppShell>;

  const sources = memo.sources_cited ?? [];

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <button onClick={() => router.push('/research')} style={{ background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer' }}>
            ← All research
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 16 }}>
          {memo.ticker && (
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{memo.ticker}</h1>
          )}
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#bbb', margin: 0 }}>{memo.topic}</h2>
          <span style={{
            padding: '2px 10px', borderRadius: 999,
            background: `${STATUS_COLOR[memo.status]}20`, color: STATUS_COLOR[memo.status],
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {memo.status}
          </span>
          <span style={{ fontSize: 11, color: '#666' }}>
            {new Date(memo.created_at).toLocaleString()}
          </span>
          {memo.memo_markdown && (
            <button
              onClick={onPrint}
              className="no-print"
              style={{
                marginLeft: 'auto', padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: 'rgba(138,92,246,0.12)', border: '1px solid #8a5cf6',
                borderRadius: 8, color: '#8a5cf6', cursor: 'pointer',
              }}
            >
              Download as PDF
            </button>
          )}
        </div>

        {/* Status chips */}
        <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, fontSize: 12, color: '#888' }}>
          <span>{memo.memo_word_count ?? 0} words</span>
          <span>·</span>
          <span>{sources.length} sources</span>
          <span>·</span>
          <span>${memo.total_cost_usd != null ? Number(memo.total_cost_usd).toFixed(4) : '—'}</span>
          <span>·</span>
          <span>{memo.total_runtime_seconds ?? '—'}s</span>
        </div>

        {/* Memo */}
        <div className="memo-body" style={{
          padding: 28, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12,
          fontSize: 14, lineHeight: 1.7,
        }}>
          {memo.status === 'running' || memo.status === 'pending' ? (
            <div style={{ color: '#f0c674', textAlign: 'center', padding: 40 }}>
              Agent is working. This page refreshes every 5 seconds.
            </div>
          ) : memo.memo_markdown ? (
            <MarkdownRenderer content={memo.memo_markdown} />
          ) : (
            <div style={{ color: '#f87171', textAlign: 'center', padding: 40 }}>
              No memo text — agent likely hit a budget or error before writing.
            </div>
          )}
        </div>

        {/* Sources */}
        {sources.length > 0 && (
          <div style={{ marginTop: 16, padding: 18, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Sources ({sources.length})
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#aaa' }}>
              {sources.map((s, i) => (
                <li key={i} style={{ marginBottom: 4, wordBreak: 'break-word' }}>
                  {s.startsWith('http') ? (
                    <a href={s} target="_blank" rel="noopener noreferrer" style={{ color: '#8a5cf6' }}>{s}</a>
                  ) : s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Prompt (collapsed) */}
        <details className="no-print" style={{ marginTop: 16, color: '#666', fontSize: 11 }}>
          <summary style={{ cursor: 'pointer' }}>Original prompt</summary>
          <pre style={{ whiteSpace: 'pre-wrap', padding: 10, background: '#0a0a1a', borderRadius: 6, marginTop: 6 }}>
            {memo.prompt}
          </pre>
        </details>

        <style jsx global>{`
          @media print {
            .no-print { display: none !important; }
            body { background: #fff !important; color: #000 !important; }
            .memo-body { border: none !important; background: #fff !important; color: #000 !important; }
          }
        `}</style>
      </div>
    </AppShell>
  );
}

function DisabledNotice() {
  return <AppShell><div style={{ padding: 40, color: '#888' }}>Deep research disabled. Set NEXT_PUBLIC_FEATURE_DEEP_RESEARCH=true.</div></AppShell>;
}

export default function Page() {
  return FEATURE ? <MemoPage /> : <DisabledNotice />;
}
