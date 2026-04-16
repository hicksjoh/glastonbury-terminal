'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const CREW_V2 = process.env.NEXT_PUBLIC_FEATURE_CREW_V2 === 'true';

type SpecialistName = 'fundamentals' | 'technicals' | 'options_flow' | 'sentiment';

type SpecialistStatus = 'pending' | 'streaming' | 'done' | 'error';

type SpecialistOutput = {
  thesis: string;
  confidence: number;
  stance: 'bullish' | 'bearish' | 'neutral';
  key_points: string[];
  citations: string[];
};

type JudgeOutput = {
  verdict: 'BULL' | 'BEAR' | 'NEUTRAL' | 'PASS';
  confidence: number;
  rationale: string;
  scores: Record<SpecialistName, number>;
  suggestedTrade: {
    structure: string;
    entry: string;
    target: string;
    stop: string;
    thesis: string;
    timeframe: string;
  } | null;
};

type SpecialistState = {
  status: SpecialistStatus;
  raw: string;
  output: SpecialistOutput | null;
  latency_ms: number | null;
  error: string | null;
};

type JudgeState = {
  status: SpecialistStatus;
  raw: string;
  output: JudgeOutput | null;
  latency_ms: number | null;
};

type DataHealth = {
  quote: boolean;
  profile: boolean;
  bars: number;
  filings: number;
  options: boolean;
  news: number;
};

type HistoryRun = {
  id: string;
  ticker: string;
  judge_verdict: 'BULL' | 'BEAR' | 'NEUTRAL' | 'PASS' | null;
  judge_confidence: number | null;
  total_cost_usd: number | null;
  total_latency_ms: number | null;
  created_at: string;
  completed_at: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
};

const SPECIALIST_LABELS: Record<SpecialistName, string> = {
  fundamentals: 'Fundamentals',
  technicals: 'Technicals',
  options_flow: 'Options Flow',
  sentiment: 'News & Sentiment',
};

const SPECIALIST_ICONS: Record<SpecialistName, string> = {
  fundamentals: '📘',
  technicals: '📈',
  options_flow: '🎯',
  sentiment: '📰',
};

const VERDICT_COLOR: Record<NonNullable<HistoryRun['judge_verdict']>, string> = {
  BULL: '#4ade80',
  BEAR: '#f87171',
  NEUTRAL: '#f0c674',
  PASS: '#8888a8',
};

function stanceColor(stance: 'bullish' | 'bearish' | 'neutral' | undefined): string {
  if (stance === 'bullish') return '#4ade80';
  if (stance === 'bearish') return '#f87171';
  return '#f0c674';
}

function confidenceColor(c: number): string {
  if (c >= 70) return '#4ade80';
  if (c >= 40) return '#f0c674';
  return '#f87171';
}

function initialSpecialist(): SpecialistState {
  return { status: 'pending', raw: '', output: null, latency_ms: null, error: null };
}

function CrewV2Page() {
  const router = useRouter();
  const [ticker, setTicker] = useState('SPY');
  const [running, setRunning] = useState(false);
  const [dataHealth, setDataHealth] = useState<DataHealth | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [totalLatency, setTotalLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fundamentals, setFundamentals] = useState<SpecialistState>(initialSpecialist);
  const [technicals, setTechnicals] = useState<SpecialistState>(initialSpecialist);
  const [optionsFlow, setOptionsFlow] = useState<SpecialistState>(initialSpecialist);
  const [sentiment, setSentiment] = useState<SpecialistState>(initialSpecialist);
  const [judge, setJudge] = useState<JudgeState>({ status: 'pending', raw: '', output: null, latency_ms: null });

  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const setSpecialist = (name: SpecialistName, patch: Partial<SpecialistState>) => {
    if (name === 'fundamentals') setFundamentals(s => ({ ...s, ...patch }));
    else if (name === 'technicals') setTechnicals(s => ({ ...s, ...patch }));
    else if (name === 'options_flow') setOptionsFlow(s => ({ ...s, ...patch }));
    else if (name === 'sentiment') setSentiment(s => ({ ...s, ...patch }));
  };

  const getSpecialist = (name: SpecialistName): SpecialistState => {
    if (name === 'fundamentals') return fundamentals;
    if (name === 'technicals') return technicals;
    if (name === 'options_flow') return optionsFlow;
    return sentiment;
  };

  const fetchHistory = useCallback(async (page = 0) => {
    try {
      const res = await fetch(`/api/crew/history?page=${page}`);
      if (!res.ok) return;
      const body = await res.json();
      setHistory(body.runs ?? []);
      setHistoryHasMore(body.hasMore ?? false);
      setHistoryPage(page);
    } catch { /* noop */ }
  }, []);

  useEffect(() => { fetchHistory(0); }, [fetchHistory]);

  const resetState = () => {
    setFundamentals(initialSpecialist());
    setTechnicals(initialSpecialist());
    setOptionsFlow(initialSpecialist());
    setSentiment(initialSpecialist());
    setJudge({ status: 'pending', raw: '', output: null, latency_ms: null });
    setDataHealth(null);
    setTotalCost(null);
    setTotalLatency(null);
    setError(null);
  };

  const analyze = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z.\-]{1,8}$/.test(sym)) {
      setError('Invalid ticker format');
      return;
    }
    resetState();
    setRunning(true);
    setStartedAt(Date.now());

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/crew/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sym }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setError(`Analyze failed: HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(payload); } catch { continue; }
          handleEvent(evt);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      fetchHistory(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, fetchHistory]);

  const handleEvent = (evt: Record<string, unknown>) => {
    const type = evt.type as string | undefined;
    if (type === 'meta') {
      if (evt.data_health) setDataHealth(evt.data_health as DataHealth);
    } else if (type === 'specialist') {
      const name = evt.name as SpecialistName;
      const event = evt.event as string;
      if (event === 'start') {
        setSpecialist(name, { status: 'streaming', raw: '', output: null, error: null });
      } else if (event === 'token') {
        const delta = evt.delta as string;
        setSpecialist(name, { raw: getSpecialist(name).raw + delta });
      } else if (event === 'done') {
        setSpecialist(name, {
          status: 'done',
          output: evt.output as SpecialistOutput,
          latency_ms: (evt.latency_ms as number) ?? null,
        });
      } else if (event === 'error') {
        setSpecialist(name, { status: 'error', error: (evt.message as string) ?? 'Unknown error' });
      }
    } else if (type === 'judge') {
      const event = evt.event as string;
      if (event === 'start') {
        setJudge({ status: 'streaming', raw: '', output: null, latency_ms: null });
      } else if (event === 'token') {
        setJudge(j => ({ ...j, raw: j.raw + (evt.delta as string) }));
      } else if (event === 'done') {
        setJudge({
          status: 'done',
          raw: '',
          output: {
            verdict: evt.verdict as JudgeOutput['verdict'],
            confidence: (evt.confidence as number) ?? 0,
            rationale: (evt.rationale as string) ?? '',
            scores: (evt.scores as JudgeOutput['scores']) ?? { fundamentals: 0, technicals: 0, options_flow: 0, sentiment: 0 },
            suggestedTrade: (evt.suggestedTrade as JudgeOutput['suggestedTrade']) ?? null,
          },
          latency_ms: (evt.latency_ms as number) ?? null,
        });
      }
    } else if (type === 'complete') {
      setTotalCost(evt.totalCostUsd as number);
      setTotalLatency(evt.totalLatencyMs as number);
    } else if (type === 'error') {
      setError((evt.message as string) ?? 'Unknown error');
    }
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  };

  const openTradeTicket = () => {
    if (!judge.output?.suggestedTrade) return;
    const t = judge.output.suggestedTrade;
    const params = new URLSearchParams({
      ticker: ticker.trim().toUpperCase(),
      structure: t.structure,
      entry: t.entry,
      target: t.target,
      stop: t.stop,
      verdict: judge.output.verdict,
    });
    router.push(`/trading?${params.toString()}`);
  };

  const elapsed = useMemo(() => {
    if (!startedAt || !running) return null;
    return Math.floor((Date.now() - startedAt) / 1000);
  }, [startedAt, running]);

  // Re-render every second while running so the elapsed timer updates
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>
            Trading Crew
          </h1>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
            Four specialists analyze in parallel. A judge synthesizes the call.
          </p>
        </div>

        {/* Ticker input */}
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: 16, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 20,
        }}>
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter' && !running) analyze(); }}
            placeholder="Ticker (e.g. SPY)"
            disabled={running}
            style={{
              width: 120, padding: '10px 12px', fontSize: 16, fontWeight: 700,
              background: '#0a0a1a', color: '#e8e8e8',
              border: '1px solid #333', borderRadius: 8, fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          {!running ? (
            <button
              onClick={analyze}
              style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 700,
                background: 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
                border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
              }}
            >
              Analyze
            </button>
          ) : (
            <button
              onClick={cancelRun}
              style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 700,
                background: 'rgba(248,113,113,0.12)', color: '#f87171',
                border: '1px solid #f87171', borderRadius: 8, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          {running && (
            <span style={{ fontSize: 13, color: '#f0c674' }}>
              ⏱ {elapsed ?? 0}s elapsed
            </span>
          )}
          {totalLatency && !running && (
            <span style={{ fontSize: 12, color: '#666' }}>
              Completed in {(totalLatency / 1000).toFixed(1)}s · ${totalCost?.toFixed(4)}
            </span>
          )}
          {dataHealth && (
            <div style={{ fontSize: 11, color: '#666', marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span>bars:{dataHealth.bars}</span>
              <span>filings:{dataHealth.filings}</span>
              <span>opt:{dataHealth.options ? '✓' : '—'}</span>
              <span>news:{dataHealth.news}</span>
            </div>
          )}
        </div>

        {error && (
          <div style={{
            padding: 12, background: '#2a1010', color: '#f87171',
            border: '1px solid #f87171', borderRadius: 8, marginBottom: 16, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Specialist grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12, marginBottom: 16,
        }}>
          {(['fundamentals', 'technicals', 'options_flow', 'sentiment'] as SpecialistName[]).map(name => (
            <SpecialistCard key={name} name={name} state={getSpecialist(name)} />
          ))}
        </div>

        {/* Judge card */}
        <JudgeCard judge={judge} onOpenTradeTicket={openTradeTicket} ticker={ticker} />

        {/* History */}
        <ErrorBoundary label="crew-history">
          <HistoryTable
            runs={history}
            page={historyPage}
            hasMore={historyHasMore}
            onPrev={() => historyPage > 0 && fetchHistory(historyPage - 1)}
            onNext={() => historyHasMore && fetchHistory(historyPage + 1)}
          />
        </ErrorBoundary>
      </div>
    </AppShell>
  );
}

// ─── Specialist card ─────────────────────────────────────────────────────────
function SpecialistCard({ name, state }: { name: SpecialistName; state: SpecialistState }) {
  const out = state.output;
  const statusChip =
    state.status === 'pending' ? { color: '#555', label: 'Queued' } :
    state.status === 'streaming' ? { color: '#8a5cf6', label: 'Streaming…' } :
    state.status === 'done' ? { color: '#4ade80', label: 'Done' } :
    { color: '#f87171', label: 'Error' };

  return (
    <div style={{
      padding: 14,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${state.status === 'done' ? `${stanceColor(out?.stance)}50` : 'rgba(138,92,246,0.15)'}`,
      borderRadius: 12,
      minHeight: 220,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{SPECIALIST_ICONS[name]}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{SPECIALIST_LABELS[name]}</span>
        </div>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 999,
          background: `${statusChip.color}20`, color: statusChip.color,
          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {statusChip.label}
        </span>
      </div>

      {out && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 6,
            background: `${stanceColor(out.stance)}20`, color: stanceColor(out.stance),
            fontWeight: 700, textTransform: 'uppercase',
          }}>
            {out.stance}
          </span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 6,
            background: `${confidenceColor(out.confidence)}20`, color: confidenceColor(out.confidence),
            fontWeight: 700,
          }}>
            {out.confidence}% conf
          </span>
          {state.latency_ms != null && (
            <span style={{ fontSize: 10, color: '#666' }}>
              {(state.latency_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {state.status === 'streaming' && !out && (
        <div style={{
          fontSize: 11, color: '#888', fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: 'pre-wrap', overflow: 'hidden', maxHeight: 100,
          opacity: 0.6, textOverflow: 'ellipsis',
        }}>
          {state.raw.slice(-200)}
          <span style={{ color: '#8a5cf6' }}>▋</span>
        </div>
      )}

      {out && (
        <>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#d0d0e0' }}>
            {out.thesis}
          </div>
          {out.key_points.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#aaa' }}>
              {out.key_points.map((kp, i) => <li key={i} style={{ marginBottom: 3 }}>{kp}</li>)}
            </ul>
          )}
          {out.citations.length > 0 && (
            <div style={{ marginTop: 4, borderTop: '1px solid #222', paddingTop: 6 }}>
              <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                Citations
              </div>
              <div style={{ fontSize: 10, color: '#888', lineHeight: 1.4 }}>
                {out.citations.map((c, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>• {c}</div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {state.status === 'error' && (
        <div style={{ fontSize: 12, color: '#f87171' }}>
          {state.error}
        </div>
      )}

      {state.status === 'pending' && (
        <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
          Queued…
        </div>
      )}
    </div>
  );
}

// ─── Judge card ──────────────────────────────────────────────────────────────
function JudgeCard({ judge, onOpenTradeTicket, ticker }: { judge: JudgeState; onOpenTradeTicket: () => void; ticker: string }) {
  if (judge.status === 'pending') {
    return (
      <div style={{
        padding: 24, background: 'rgba(255,255,255,0.02)',
        border: '1px dashed #333', borderRadius: 12, marginBottom: 20,
        textAlign: 'center', color: '#666', fontSize: 13,
      }}>
        Judge waits on specialists.
      </div>
    );
  }

  if (judge.status === 'streaming' && !judge.output) {
    return (
      <div style={{
        padding: 20, background: 'rgba(138,92,246,0.06)',
        border: '1px solid #8a5cf6', borderRadius: 12, marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#8a5cf6', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Judge deliberating…
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#888',
          whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden',
        }}>
          {judge.raw.slice(-500)}<span style={{ color: '#8a5cf6' }}>▋</span>
        </div>
      </div>
    );
  }

  const out = judge.output!;
  const vc = VERDICT_COLOR[out.verdict];

  return (
    <div style={{
      padding: 20, background: `linear-gradient(135deg, ${vc}10, ${vc}04)`,
      border: `2px solid ${vc}`, borderRadius: 16, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: vc, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
            Judge Verdict
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: vc, letterSpacing: '0.02em' }}>{out.verdict}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: confidenceColor(out.confidence) }}>
              {out.confidence}% conf
            </span>
            {judge.latency_ms != null && (
              <span style={{ fontSize: 11, color: '#666' }}>
                {(judge.latency_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>

        {out.suggestedTrade && (out.verdict === 'BULL' || out.verdict === 'BEAR') && (
          <button
            onClick={onOpenTradeTicket}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 700,
              background: vc, border: 'none', borderRadius: 8,
              color: '#080b14', cursor: 'pointer',
            }}
          >
            Open as Trade Ticket →
          </button>
        )}
      </div>

      {/* Specialist scores */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['fundamentals', 'technicals', 'options_flow', 'sentiment'] as SpecialistName[]).map(name => {
          const s = out.scores[name];
          return (
            <div key={name} style={{
              padding: '6px 12px', background: 'rgba(255,255,255,0.03)',
              border: '1px solid #333', borderRadius: 8,
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <span style={{ fontSize: 14 }}>{SPECIALIST_ICONS[name]}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{SPECIALIST_LABELS[name]}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: confidenceColor(s * 10) }}>
                {s}/10
              </span>
            </div>
          );
        })}
      </div>

      {/* Rationale */}
      <div style={{ fontSize: 13, lineHeight: 1.6, color: '#e0e0e0', marginBottom: 14 }}>
        {out.rationale}
      </div>

      {/* Suggested trade */}
      {out.suggestedTrade && (
        <div style={{
          padding: 14, background: 'rgba(0,0,0,0.3)',
          border: '1px solid #333', borderRadius: 10,
        }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Suggested Trade — {ticker.toUpperCase()}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', marginBottom: 8 }}>
            {out.suggestedTrade.structure}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 12 }}>
            <div><span style={{ color: '#666' }}>Entry:</span> <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{out.suggestedTrade.entry}</span></div>
            <div><span style={{ color: '#666' }}>Target:</span> <span style={{ color: '#4ade80', fontWeight: 600 }}>{out.suggestedTrade.target}</span></div>
            <div><span style={{ color: '#666' }}>Stop:</span> <span style={{ color: '#f87171', fontWeight: 600 }}>{out.suggestedTrade.stop}</span></div>
            <div><span style={{ color: '#666' }}>Timeframe:</span> <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{out.suggestedTrade.timeframe}</span></div>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 8, lineHeight: 1.5 }}>
            {out.suggestedTrade.thesis}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────
function HistoryTable({
  runs, page, hasMore, onPrev, onNext,
}: {
  runs: HistoryRun[];
  page: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{
      padding: 16, background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Recent Crew Runs
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onPrev} disabled={page === 0}
            style={{ background: 'none', border: '1px solid #333', color: page === 0 ? '#333' : '#888', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: page === 0 ? 'not-allowed' : 'pointer' }}>
            ← Prev
          </button>
          <button onClick={onNext} disabled={!hasMore}
            style={{ background: 'none', border: '1px solid #333', color: hasMore ? '#888' : '#333', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: hasMore ? 'pointer' : 'not-allowed' }}>
            Next →
          </button>
        </div>
      </div>
      {runs.length === 0 ? (
        <div style={{ fontSize: 12, color: '#666', padding: 20, textAlign: 'center' }}>
          No runs yet. Pick a ticker above and hit Analyze.
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#555', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>When</th>
                <th style={{ padding: '6px 8px' }}>Ticker</th>
                <th style={{ padding: '6px 8px' }}>Verdict</th>
                <th style={{ padding: '6px 8px' }}>Conf</th>
                <th style={{ padding: '6px 8px' }}>Latency</th>
                <th style={{ padding: '6px 8px' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #1a1a2a' }}>
                  <td style={{ padding: '8px', color: '#888' }}>{formatDate(r.created_at)}</td>
                  <td style={{ padding: '8px', color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{r.ticker}</td>
                  <td style={{ padding: '8px' }}>
                    {r.judge_verdict ? (
                      <span style={{
                        padding: '1px 8px', borderRadius: 4,
                        background: `${VERDICT_COLOR[r.judge_verdict]}20`,
                        color: VERDICT_COLOR[r.judge_verdict], fontWeight: 700, fontSize: 11,
                      }}>
                        {r.judge_verdict}
                      </span>
                    ) : <span style={{ color: '#444' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px', color: '#aaa' }}>
                    {r.judge_confidence != null ? `${Math.round(r.judge_confidence)}%` : '—'}
                  </td>
                  <td style={{ padding: '8px', color: '#666' }}>
                    {r.total_latency_ms != null ? `${(r.total_latency_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td style={{ padding: '8px', color: '#666' }}>
                    {r.total_cost_usd != null ? `$${Number(r.total_cost_usd).toFixed(4)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return s;
  }
}

// ─── Flag gate ───────────────────────────────────────────────────────────────
function LegacyNotice() {
  return (
    <AppShell>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{
          maxWidth: 520, padding: 24, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(138,92,246,0.2)', borderRadius: 12, textAlign: 'center',
        }}>
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, color: '#e8e8e8' }}>
            Trading Crew v2 disabled
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            Set <code style={{ color: '#f0c674', background: '#0a0a1a', padding: '2px 6px', borderRadius: 4 }}>NEXT_PUBLIC_FEATURE_CREW_V2=true</code> in <code style={{ color: '#f0c674' }}>.env.local</code> and restart to enable the parallel specialist + judge UI.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return CREW_V2 ? <CrewV2Page /> : <LegacyNotice />;
}
