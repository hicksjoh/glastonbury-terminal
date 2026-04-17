'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_DEEP_RESEARCH === 'true';

type MemoListRow = {
  id: string;
  ticker: string | null;
  topic: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  memo_word_count: number | null;
  total_cost_usd: number | null;
  total_runtime_seconds: number | null;
  created_at: string;
  completed_at: string | null;
};

const STATUS_COLOR: Record<MemoListRow['status'], string> = {
  pending: '#888',
  running: '#f0c674',
  completed: '#4ade80',
  failed: '#f87171',
  cancelled: '#8888a8',
};

function ResearchListInner() {
  const router = useRouter();
  const [memos, setMemos] = useState<MemoListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>('');
  const [liveUsage, setLiveUsage] = useState<{ tokensOut: number; cost: number; iters: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/research/list');
      const body = await res.json();
      setMemos(body.memos ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll list every 5s while a run is active
  useEffect(() => {
    if (!liveMemoId) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [liveMemoId, load]);

  const startDive = async () => {
    const sym = ticker.trim().toUpperCase();
    if (sym && !/^[A-Z.\-]{1,8}$/.test(sym)) { setError('Invalid ticker'); return; }
    if (!sym && !topic.trim()) { setError('Provide a ticker or a free-form topic'); return; }

    setStarting(true);
    setError(null);
    setLiveUsage(null);
    setLiveStatus('starting…');

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/research/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: sym || undefined,
          topic: topic.trim() || (sym ? `${sym} deep dive` : ''),
          prompt: prompt.trim() || `Deliver a full 1500-2500 word research memo${sym ? ` on ${sym}` : ''}. Use every tool you need.`,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) { setError(`HTTP ${res.status}`); setStarting(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const f of frames) {
          const line = f.trim();
          if (!line.startsWith('data:')) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (evt.type === 'memo_created') {
            setLiveMemoId(evt.memoId as string);
            load();
          } else if (evt.type === 'status') {
            setLiveStatus(`${evt.phase}${evt.detail ? ` · ${evt.detail}` : ''}`);
          } else if (evt.type === 'tool_use') {
            setLiveStatus(`tool: ${evt.tool}`);
          } else if (evt.type === 'usage') {
            setLiveUsage({
              tokensOut: evt.cumTokensOut as number,
              cost: evt.cumCostUsd as number,
              iters: evt.iterations as number,
            });
          } else if (evt.type === 'complete') {
            setLiveStatus(`done · ${evt.wordCount} words · $${Number(evt.totalCostUsd).toFixed(4)}`);
            setLiveMemoId(null);
            load();
            // Navigate to the memo
            setTimeout(() => router.push(`/research/${evt.memoId}`), 400);
          } else if (evt.type === 'error') {
            setError(String(evt.message));
            setLiveStatus('error');
            setLiveMemoId(null);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>Deep Research</h1>
        <p style={{ fontSize: 13, color: '#888', margin: 0, marginBottom: 20 }}>
          Buy-side equity memo, produced by Claude Opus with web search + filings + news tools.
        </p>

        {/* New deep dive form */}
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            New Deep Dive
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="Ticker"
              disabled={starting}
              style={{
                width: 120, padding: '10px 12px', fontSize: 15, fontWeight: 700,
                background: '#0a0a1a', color: '#e8e8e8',
                border: '1px solid #333', borderRadius: 8, fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Or free-form topic (e.g. 'AI chip supply chain 2026')"
              disabled={starting}
              style={{
                flex: 1, minWidth: 240, padding: '10px 12px', fontSize: 13,
                background: '#0a0a1a', color: '#e8e8e8',
                border: '1px solid #333', borderRadius: 8,
              }}
            />
          </div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Optional: specific angle or questions to prioritize. Leave blank for the full default memo."
            disabled={starting}
            style={{
              width: '100%', minHeight: 70, padding: 10, fontSize: 12,
              background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333',
              borderRadius: 8, resize: 'vertical', marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={startDive}
              disabled={starting}
              style={{
                padding: '10px 22px', fontSize: 14, fontWeight: 700,
                background: starting ? 'rgba(138,92,246,0.2)' : 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
                border: 'none', borderRadius: 8, color: '#fff',
                cursor: starting ? 'wait' : 'pointer',
                opacity: starting ? 0.7 : 1,
              }}
            >
              {starting ? 'Researching…' : 'Start Deep Dive'}
            </button>
            {liveStatus && (
              <span style={{ fontSize: 12, color: '#f0c674' }}>{liveStatus}</span>
            )}
            {liveUsage && (
              <span style={{ fontSize: 11, color: '#666' }}>
                iter {liveUsage.iters} · {liveUsage.tokensOut} out · ${liveUsage.cost.toFixed(4)}
              </span>
            )}
          </div>
          {error && (
            <div style={{ marginTop: 10, padding: 10, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 6, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Memo history */}
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Recent Memos
          </div>
          {loading ? (
            <div style={{ color: '#666', fontSize: 12, padding: 20, textAlign: 'center' }}>Loading…</div>
          ) : memos.length === 0 ? (
            <div style={{ color: '#666', fontSize: 12, padding: 20, textAlign: 'center' }}>
              No memos yet. Start your first deep dive above.
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#555', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>When</th>
                  <th style={{ padding: '6px 8px' }}>Topic</th>
                  <th style={{ padding: '6px 8px' }}>Ticker</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Words</th>
                  <th style={{ padding: '6px 8px' }}>Cost</th>
                  <th style={{ padding: '6px 8px' }}>Runtime</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {memos.map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid #1a1a2a' }}>
                    <td style={{ padding: '8px', color: '#888' }}>
                      {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px', color: '#e8e8e8' }}>{m.topic}</td>
                    <td style={{ padding: '8px', color: '#aaa', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                      {m.ticker ?? '—'}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        padding: '1px 8px', borderRadius: 4,
                        background: `${STATUS_COLOR[m.status]}20`, color: STATUS_COLOR[m.status],
                        fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
                      }}>
                        {m.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px', color: '#aaa' }}>
                      {m.memo_word_count ?? '—'}
                    </td>
                    <td style={{ padding: '8px', color: '#666' }}>
                      {m.total_cost_usd != null ? `$${Number(m.total_cost_usd).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '8px', color: '#666' }}>
                      {m.total_runtime_seconds != null ? `${m.total_runtime_seconds}s` : '—'}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <button
                        onClick={() => router.push(`/research/${m.id}`)}
                        style={{ background: 'none', border: '1px solid #333', color: '#8a5cf6', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer' }}
                      >
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DisabledNotice() {
  return (
    <AppShell>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{
          maxWidth: 520, padding: 24, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(138,92,246,0.2)', borderRadius: 12, textAlign: 'center',
        }}>
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18 }}>
            Deep Research disabled
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            Set <code style={{ color: '#f0c674' }}>NEXT_PUBLIC_FEATURE_DEEP_RESEARCH=true</code> and restart.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return FEATURE ? <ResearchListInner /> : <DisabledNotice />;
}
