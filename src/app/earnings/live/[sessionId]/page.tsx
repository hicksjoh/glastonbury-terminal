'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import MarkdownRenderer from '@/components/MarkdownRenderer';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_EARNINGS_COPILOT === 'true';

type Chunk = {
  id: string;
  seq: number;
  speaker: string | null;
  chunk_text: string;
  sentiment_score: number | null;
  sentiment_tags: string[] | null;
  created_at: string;
};

type Session = {
  id: string;
  ticker: string;
  call_date: string;
  quarter: string | null;
  status: 'scheduled' | 'live' | 'completed' | 'failed';
  source_url: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type Memo = {
  memo_text: string;
  keisha_take: string;
  guidance_delta: string;
  key_quotes: { speaker: string; quote: string; why_it_matters: string }[];
  created_at: string;
};

const POLL_MS = 2000;
const SCORE_MS = 30_000;

function sentColor(score: number | null): string {
  if (score == null) return '#555';
  if (score > 0.25) return '#4ade80';
  if (score < -0.25) return '#f87171';
  return '#f0c674';
}

function WorkspaceInner() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  // params is typed as nullable by next/navigation — in practice it is
  // populated for this dynamic route, but TS's strict mode (tightened
  // by `next build`'s generated .next/types/) requires a fallback.
  const sessionId = params?.sessionId ?? '';

  const [session, setSession] = useState<Session | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [ingestMode, setIngestMode] = useState<'paste' | 'fmp' | 'whisper'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);
  const [fmpYear, setFmpYear] = useState(new Date().getFullYear());
  const [fmpQuarter, setFmpQuarter] = useState(1);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerStreaming, setAnswerStreaming] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);

  const [endingCall, setEndingCall] = useState(false);

  const lastSeqRef = useRef<number>(-1);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/earnings/live/session/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setSession(body.session as Session);
      setChunks((body.chunks as Chunk[]) ?? []);
      if (body.memo) setMemo(body.memo as Memo);
      lastSeqRef.current = body.chunks?.length ? body.chunks[body.chunks.length - 1].seq : -1;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Poll for new chunks every POLL_MS
  useEffect(() => {
    if (!session || session.status === 'completed') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/earnings/live/session/${sessionId}?since=${lastSeqRef.current}`);
        if (!res.ok) return;
        const body = await res.json();
        const incoming: Chunk[] = body.chunks ?? [];
        if (incoming.length > 0) {
          setChunks(prev => {
            // Merge new chunks (avoid duplicates)
            const existingIds = new Set(prev.map(c => c.id));
            const merged = [...prev];
            for (const c of incoming) {
              if (!existingIds.has(c.id)) merged.push(c);
            }
            merged.sort((a, b) => a.seq - b.seq);
            return merged;
          });
          lastSeqRef.current = incoming[incoming.length - 1].seq;
        }
        // Refresh sentiment for already-displayed chunks (they may have been scored since last poll)
        await refreshSentimentForExistingChunks();
      } catch { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionId]);

  // Periodically tick the sentiment scorer
  useEffect(() => {
    if (!session || session.status === 'completed') return;
    const id = setInterval(async () => {
      try {
        await fetch(`/api/earnings/live/session/${sessionId}/score`, { method: 'POST' });
        await refreshSentimentForExistingChunks();
      } catch { /* silent */ }
    }, SCORE_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionId]);

  async function refreshSentimentForExistingChunks() {
    try {
      const res = await fetch(`/api/earnings/live/session/${sessionId}?since=-1`);
      if (!res.ok) return;
      const body = await res.json();
      const all: Chunk[] = body.chunks ?? [];
      setChunks(all);
    } catch { /* silent */ }
  }

  // Auto-scroll transcript to bottom when new chunks arrive
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is near bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chunks]);

  const submitIngest = async () => {
    if (!session) return;
    setIngestBusy(true);
    setError(null);
    try {
      let res: Response;
      if (ingestMode === 'paste') {
        if (!pasteText.trim()) { setError('Empty paste'); return; }
        res = await fetch(`/api/earnings/live/session/${sessionId}/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'paste', text: pasteText }),
        });
      } else if (ingestMode === 'fmp') {
        res = await fetch(`/api/earnings/live/session/${sessionId}/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fmp', year: fmpYear, quarter: fmpQuarter }),
        });
      } else {
        // whisper = use file input fallback; handled by onFileChange
        setIngestBusy(false);
        return;
      }
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Ingest failed'); return; }
      setPasteText('');
      // Trigger an immediate reload + score tick
      await loadInitial();
      fetch(`/api/earnings/live/session/${sessionId}/score`, { method: 'POST' }).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIngestBusy(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIngestBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`/api/earnings/live/session/${sessionId}/ingest`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Whisper failed'); return; }
      await loadInitial();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIngestBusy(false);
      e.target.value = '';
    }
  };

  const askKeisha = async () => {
    if (!question.trim() || answerStreaming) return;
    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    setAnswer('');
    setAnswerStreaming(true);
    try {
      const res = await fetch(`/api/earnings/live/session/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) { setError(`Chat failed: ${res.status}`); setAnswerStreaming(false); return; }
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
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === 'token' && evt.delta) {
              setAnswer(prev => prev + evt.delta);
            } else if (evt.type === 'error') {
              setError(evt.message);
            }
          } catch { /* bad frame */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setAnswerStreaming(false);
    }
  };

  const endCall = async () => {
    if (!session || endingCall) return;
    if (!confirm('End the call and generate the post-call memo?')) return;
    setEndingCall(true);
    setError(null);
    try {
      const res = await fetch(`/api/earnings/live/session/${sessionId}/end`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'End failed'); return; }
      setMemo({
        memo_text: body.memo.memo_markdown,
        keisha_take: body.memo.keisha_take,
        guidance_delta: body.memo.guidance_delta,
        key_quotes: body.memo.key_quotes,
        created_at: new Date().toISOString(),
      });
      await loadInitial();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEndingCall(false);
    }
  };

  // Derived: recent key quotes (top sentiment magnitude)
  const keyQuotes = useMemo(() => {
    return [...chunks]
      .filter(c => c.sentiment_score != null && Math.abs(c.sentiment_score) >= 0.5)
      .sort((a, b) => Math.abs(b.sentiment_score ?? 0) - Math.abs(a.sentiment_score ?? 0))
      .slice(0, 6);
  }, [chunks]);

  // Sentiment heat strip: 20 buckets across chunks
  const heatStrip = useMemo(() => {
    const scored = chunks.filter(c => c.sentiment_score != null);
    const N = 20;
    if (scored.length === 0) return Array(N).fill(null);
    const buckets: Array<number[]> = Array.from({ length: N }, () => []);
    scored.forEach((c, i) => {
      const idx = Math.min(N - 1, Math.floor((i / scored.length) * N));
      buckets[idx].push(c.sentiment_score ?? 0);
    });
    return buckets.map(b => b.length === 0 ? null : b.reduce((a, v) => a + v, 0) / b.length);
  }, [chunks]);

  if (loading) {
    return <AppShell><div style={{ padding: 40, color: '#888' }}>Loading session…</div></AppShell>;
  }
  if (!session) {
    return <AppShell><div style={{ padding: 40, color: '#f87171' }}>Session not found</div></AppShell>;
  }

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
          <button onClick={() => router.push('/earnings/live')}
            style={{ background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer' }}>
            ← All sessions
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{session.ticker}</h1>
          <span style={{ fontSize: 13, color: '#888' }}>{session.quarter ?? 'Live'} · {session.call_date}</span>
          <span style={{
            padding: '2px 10px', borderRadius: 999,
            background: session.status === 'live' ? '#4ade8022' : '#8a5cf622',
            color: session.status === 'live' ? '#4ade80' : '#8a5cf6',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {session.status}
          </span>
          {session.status !== 'completed' && (
            <button
              onClick={endCall}
              disabled={endingCall || chunks.length === 0}
              style={{
                marginLeft: 'auto', padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: endingCall ? 'rgba(138,92,246,0.15)' : 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
                border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
                opacity: (endingCall || chunks.length === 0) ? 0.5 : 1,
              }}
            >
              {endingCall ? 'Generating memo…' : 'End Call + Generate Memo'}
            </button>
          )}
        </div>

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Ingest panel */}
        {session.status !== 'completed' && (
          <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['paste', 'fmp', 'whisper'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setIngestMode(m)}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600,
                    background: ingestMode === m ? 'rgba(138,92,246,0.2)' : 'transparent',
                    border: `1px solid ${ingestMode === m ? '#8a5cf6' : '#333'}`,
                    color: ingestMode === m ? '#8a5cf6' : '#888',
                    borderRadius: 6, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}
                >
                  {m === 'paste' ? 'Paste' : m === 'fmp' ? 'FMP Replay' : 'Whisper'}
                </button>
              ))}
            </div>

            {ingestMode === 'paste' && (
              <>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste transcript text. Speaker-prefixed lines (&quot;Tim Cook: …&quot;) parse cleanly."
                  style={{
                    width: '100%', minHeight: 100, padding: 10, fontSize: 12,
                    background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333',
                    borderRadius: 8, fontFamily: "'JetBrains Mono', monospace", resize: 'vertical',
                  }}
                />
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={submitIngest}
                    disabled={ingestBusy}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 700,
                      background: '#8a5cf6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer',
                      opacity: ingestBusy ? 0.5 : 1,
                    }}
                  >
                    {ingestBusy ? 'Ingesting…' : 'Send Chunk'}
                  </button>
                </div>
              </>
            )}

            {ingestMode === 'fmp' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: '#888' }}>Year</label>
                <input type="number" value={fmpYear} onChange={e => setFmpYear(Number(e.target.value))}
                  style={{ width: 80, padding: 6, background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333', borderRadius: 6, fontSize: 12 }} />
                <label style={{ fontSize: 12, color: '#888' }}>Quarter</label>
                <select value={fmpQuarter} onChange={e => setFmpQuarter(Number(e.target.value))}
                  style={{ padding: 6, background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333', borderRadius: 6, fontSize: 12 }}>
                  <option value={1}>Q1</option><option value={2}>Q2</option><option value={3}>Q3</option><option value={4}>Q4</option>
                </select>
                <button
                  onClick={submitIngest}
                  disabled={ingestBusy}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 700,
                    background: '#8a5cf6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer',
                    opacity: ingestBusy ? 0.5 : 1,
                  }}
                >
                  {ingestBusy ? 'Importing…' : `Import ${session.ticker} ${fmpYear} Q${fmpQuarter}`}
                </button>
              </div>
            )}

            {ingestMode === 'whisper' && (
              <div>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={onFileChange}
                  disabled={ingestBusy}
                  style={{ color: '#888', fontSize: 12 }}
                />
                <p style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                  Requires OPENAI_API_KEY env var. Uses OpenAI whisper-1. Max ~25MB per file.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Main workspace grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>
          {/* Transcript */}
          <div style={{
            padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)',
            borderRadius: 12, height: 520, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Transcript ({chunks.length})
              </div>
              {chunks.some(c => c.sentiment_score == null) && (
                <span style={{ fontSize: 10, color: '#f0c674' }}>Scoring…</span>
              )}
            </div>
            <div ref={transcriptScrollRef} style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
              {chunks.length === 0 ? (
                <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40 }}>
                  No transcript yet. Use the ingest panel above.
                </div>
              ) : chunks.map(c => (
                <div key={c.id} style={{
                  padding: '8px 10px',
                  borderLeft: `3px solid ${sentColor(c.sentiment_score)}`,
                  background: 'rgba(0,0,0,0.3)', borderRadius: 6,
                }}>
                  {c.speaker && (
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                      {c.speaker}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#d0d0e0', lineHeight: 1.5 }}>
                    {c.chunk_text}
                  </div>
                  {c.sentiment_tags && c.sentiment_tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {c.sentiment_tags.map((tag, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 4,
                          background: `${sentColor(c.sentiment_score)}20`, color: sentColor(c.sentiment_score),
                          fontWeight: 600,
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right column: sentiment + key quotes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Sentiment Heat
              </div>
              <div style={{ display: 'flex', gap: 2, height: 32 }}>
                {heatStrip.map((score, i) => (
                  <div key={i} style={{
                    flex: 1, borderRadius: 3,
                    background: score == null ? '#1a1a2a' : sentColor(score),
                    opacity: score == null ? 0.4 : Math.max(0.4, Math.abs(score)),
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Open</span><span>Now</span>
              </div>
            </div>

            <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12, flex: 1, overflowY: 'auto', maxHeight: 360 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Key Quotes
              </div>
              {keyQuotes.length === 0 ? (
                <div style={{ fontSize: 11, color: '#555' }}>Waiting for high-signal passages…</div>
              ) : keyQuotes.map(c => (
                <div key={c.id} style={{
                  padding: 8, marginBottom: 8, borderRadius: 6,
                  background: 'rgba(0,0,0,0.3)', borderLeft: `3px solid ${sentColor(c.sentiment_score)}`,
                }}>
                  <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', marginBottom: 3 }}>
                    {c.speaker ?? 'Speaker'}
                  </div>
                  <div style={{ fontSize: 11, color: '#d0d0e0', lineHeight: 1.4 }}>
                    {c.chunk_text.length > 180 ? c.chunk_text.slice(0, 180) + '…' : c.chunk_text}
                  </div>
                  <div style={{ fontSize: 10, color: sentColor(c.sentiment_score), fontWeight: 600, marginTop: 3 }}>
                    {((c.sentiment_score ?? 0) * 100).toFixed(0)}% · {(c.sentiment_tags ?? []).slice(0, 2).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chat input */}
        <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f0c674', marginBottom: 8 }}>
            Ask Keisha (grounded in the transcript)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !answerStreaming) askKeisha(); }}
              placeholder="What did they say about margin pressure?"
              disabled={answerStreaming}
              style={{
                flex: 1, padding: 10, fontSize: 13,
                background: '#0a0a1a', color: '#e8e8e8', border: '1px solid #333', borderRadius: 8,
              }}
            />
            <button
              onClick={askKeisha}
              disabled={answerStreaming || !question.trim()}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 700,
                background: 'linear-gradient(135deg, #f0c674, #c9a84c)',
                border: 'none', borderRadius: 8, color: '#080b14', cursor: 'pointer',
                opacity: (answerStreaming || !question.trim()) ? 0.5 : 1,
              }}
            >
              {answerStreaming ? '…' : 'Ask'}
            </button>
          </div>
          {answer && (
            <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 8, fontSize: 13, color: '#d0d0e0', lineHeight: 1.5 }}>
              <div style={{ fontSize: 10, color: '#f0c674', textTransform: 'uppercase', marginBottom: 4 }}>Keisha</div>
              <MarkdownRenderer content={answer} compact />
              {answerStreaming && <span style={{ color: '#f0c674' }}>▋</span>}
            </div>
          )}
        </div>

        {/* Memo (when present) */}
        {memo && (
          <div style={{ padding: 18, background: 'linear-gradient(135deg, rgba(138,92,246,0.08), rgba(138,92,246,0.02))', border: '2px solid #8a5cf6', borderRadius: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#8a5cf6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Post-Call Memo · {session.ticker} {session.quarter ? `· ${session.quarter}` : ''}
              </div>
              <div style={{ fontSize: 11, color: '#888' }}>
                Guidance: <span style={{ color: '#f0c674', fontWeight: 700 }}>{memo.guidance_delta}</span>
              </div>
            </div>
            {memo.keisha_take && (
              <div style={{ padding: 12, marginBottom: 12, background: 'rgba(240,198,116,0.08)', borderLeft: '3px solid #f0c674', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Keisha&apos;s Take
                </div>
                <div style={{ fontSize: 13, color: '#e8e8e8', lineHeight: 1.5 }}>
                  {memo.keisha_take}
                </div>
              </div>
            )}
            <MarkdownRenderer content={memo.memo_text} compact />
            {memo.key_quotes.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #333' }}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Key Quotes
                </div>
                {memo.key_quotes.map((q, i) => (
                  <div key={i} style={{ padding: 10, marginBottom: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 10, color: '#8a5cf6', textTransform: 'uppercase', marginBottom: 3 }}>{q.speaker}</div>
                    <div style={{ fontSize: 12, color: '#d0d0e0', fontStyle: 'italic', marginBottom: 4 }}>&quot;{q.quote}&quot;</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{q.why_it_matters}</div>
                  </div>
                ))}
              </div>
            )}
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
        <div style={{
          maxWidth: 520, padding: 24, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(138,92,246,0.2)', borderRadius: 12, textAlign: 'center',
        }}>
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, color: '#e8e8e8' }}>
            Earnings co-pilot disabled
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            Set <code style={{ color: '#f0c674' }}>NEXT_PUBLIC_FEATURE_EARNINGS_COPILOT=true</code> and restart.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return FEATURE ? <WorkspaceInner /> : <DisabledNotice />;
}
