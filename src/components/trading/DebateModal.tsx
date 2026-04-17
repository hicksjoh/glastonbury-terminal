'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Verdict = 'BULL' | 'BEAR' | 'NEUTRAL' | 'PASS';
type RoundText = { n: number; text: string };

export type DebateModalProps = {
  ticker: string;
  proposedTrade?: { side: 'buy' | 'sell'; qty?: number; entry?: string } | null;
  onClose: () => void;
  onDecision?: (decision: 'took_trade' | 'passed' | 'modified' | 'deferred') => void;
};

const VERDICT_COLOR: Record<Verdict, string> = {
  BULL: '#4ade80', BEAR: '#f87171', NEUTRAL: '#f0c674', PASS: '#8888a8',
};

export function DebateModal({ ticker, proposedTrade, onClose, onDecision }: DebateModalProps) {
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
  const [error, setError] = useState<string | null>(null);
  const [bullRounds, setBullRounds] = useState<RoundText[]>([]);
  const [bearRounds, setBearRounds] = useState<RoundText[]>([]);
  const [bullLive, setBullLive] = useState('');
  const [bearLive, setBearLive] = useState('');
  const [liveSide, setLiveSide] = useState<'bull' | 'bear' | null>(null);
  const [liveRound, setLiveRound] = useState<number | null>(null);
  const [modLive, setModLive] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [rationale, setRationale] = useState('');
  const [tensionPoints, setTensionPoints] = useState<Array<{ point: string; bull_claim: string; bear_claim: string; my_view: string }>>([]);
  const [debateId, setDebateId] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus('running');
    setError(null);
    setBullRounds([]); setBearRounds([]); setBullLive(''); setBearLive(''); setModLive('');
    setVerdict(null); setConfidence(0); setRationale(''); setTensionPoints([]);

    try {
      const res = await fetch('/api/debate/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, proposedTrade }), signal: ac.signal,
      });
      if (!res.ok || !res.body) { setError(`HTTP ${res.status}`); setStatus('error'); return; }
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
          handle(evt);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { setError((err as Error).message); setStatus('error'); }
    }
  }, [ticker, proposedTrade]);

  const handle = (evt: Record<string, unknown>) => {
    const type = evt.type as string;
    if (type === 'round') {
      const side = evt.side as 'bull' | 'bear';
      const n = evt.n as number;
      const event = evt.event as string;
      if (event === 'start') {
        setLiveSide(side); setLiveRound(n);
        if (side === 'bull') setBullLive(''); else setBearLive('');
      } else if (event === 'token') {
        const delta = evt.delta as string;
        if (side === 'bull') setBullLive(p => p + delta);
        else setBearLive(p => p + delta);
      } else if (event === 'done') {
        const text = evt.text as string;
        if (side === 'bull') { setBullRounds(p => [...p, { n, text }]); setBullLive(''); }
        else { setBearRounds(p => [...p, { n, text }]); setBearLive(''); }
        setLiveSide(null); setLiveRound(null);
      }
    } else if (type === 'moderator') {
      const event = evt.event as string;
      if (event === 'token') setModLive(p => p + (evt.delta as string));
      else if (event === 'done') {
        setVerdict((evt.verdict as Verdict) ?? 'NEUTRAL');
        setConfidence((evt.confidence as number) ?? 0);
        setRationale((evt.rationale as string) ?? '');
        setTensionPoints((evt.tension_points as Array<{ point: string; bull_claim: string; bear_claim: string; my_view: string }>) ?? []);
        setModLive('');
      }
    } else if (type === 'complete') {
      setDebateId((evt.debateId as string | null) ?? null);
      setTotalCost(evt.totalCostUsd as number);
      setStatus('done');
    } else if (type === 'error') {
      setError(String(evt.message)); setStatus('error');
    }
  };

  useEffect(() => { start(); return () => abortRef.current?.abort(); }, [start]);

  const decide = async (d: 'took_trade' | 'passed' | 'modified' | 'deferred') => {
    if (debateId) {
      fetch('/api/debate/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: debateId, decision: d }),
      }).catch(() => {});
    }
    onDecision?.(d);
    onClose();
  };

  const vc = verdict ? VERDICT_COLOR[verdict] : '#8a5cf6';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#0a0a1a', border: `2px solid ${vc}`, borderRadius: 16, width: '100%', maxWidth: 1100, maxHeight: '92vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: vc, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Bull vs Bear Debate
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
              {ticker}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* 3-column layout: Bull | Moderator | Bear */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* Bull column */}
          <div style={{ padding: 12, background: 'rgba(74,222,128,0.06)', border: '1px solid #4ade80', borderRadius: 10, minHeight: 300 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', marginBottom: 8 }}>
              🐂 Bull
            </div>
            {[1, 2, 3].map(n => {
              const done = bullRounds.find(r => r.n === n);
              const isLive = liveSide === 'bull' && liveRound === n;
              return (
                <div key={n} style={{ marginBottom: 8, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, opacity: done || isLive ? 1 : 0.4 }}>
                  <div style={{ fontSize: 9, color: '#4ade80', textTransform: 'uppercase', marginBottom: 3 }}>Round {n}</div>
                  <div style={{ fontSize: 11, color: '#d0d0e0', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    {done ? done.text : isLive ? <>{bullLive}<span style={{ color: '#4ade80' }}>▋</span></> : '…'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Moderator column */}
          <div style={{ padding: 12, background: `${vc}10`, border: `1px solid ${vc}`, borderRadius: 10, minHeight: 300 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: vc, textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
              ⚖ Moderator
            </div>
            {verdict ? (
              <>
                <div style={{ fontSize: 32, fontWeight: 800, color: vc, textAlign: 'center', letterSpacing: '0.03em' }}>
                  {verdict}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', textAlign: 'center', marginBottom: 10 }}>
                  {confidence}% confidence
                </div>
                <div style={{ fontSize: 12, color: '#d0d0e0', lineHeight: 1.5 }}>
                  {rationale}
                </div>
              </>
            ) : status === 'running' && modLive ? (
              <div style={{ fontSize: 10, color: '#888', whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace" }}>
                {modLive.slice(-500)}<span style={{ color: vc }}>▋</span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#555', textAlign: 'center', padding: 20 }}>
                Waiting on debate…
              </div>
            )}
          </div>

          {/* Bear column */}
          <div style={{ padding: 12, background: 'rgba(248,113,113,0.06)', border: '1px solid #f87171', borderRadius: 10, minHeight: 300 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', marginBottom: 8, textAlign: 'right' }}>
              Bear 🐻
            </div>
            {[1, 2, 3].map(n => {
              const done = bearRounds.find(r => r.n === n);
              const isLive = liveSide === 'bear' && liveRound === n;
              return (
                <div key={n} style={{ marginBottom: 8, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, opacity: done || isLive ? 1 : 0.4 }}>
                  <div style={{ fontSize: 9, color: '#f87171', textTransform: 'uppercase', marginBottom: 3, textAlign: 'right' }}>Round {n}</div>
                  <div style={{ fontSize: 11, color: '#d0d0e0', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    {done ? done.text : isLive ? <>{bearLive}<span style={{ color: '#f87171' }}>▋</span></> : '…'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tension points */}
        {tensionPoints.length > 0 && (
          <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid #333', borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Key Tension Points
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tensionPoints.map((tp, i) => (
                <div key={i} style={{ padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e8e8e8', marginBottom: 4 }}>{tp.point}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10, color: '#aaa' }}>
                    <div><span style={{ color: '#4ade80', fontWeight: 700 }}>Bull:</span> {tp.bull_claim}</div>
                    <div><span style={{ color: '#f87171', fontWeight: 700 }}>Bear:</span> {tp.bear_claim}</div>
                  </div>
                  {tp.my_view && (
                    <div style={{ fontSize: 10, color: vc, marginTop: 4 }}><span style={{ fontWeight: 700 }}>Moderator:</span> {tp.my_view}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {status === 'done' && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', paddingTop: 8, borderTop: '1px solid #222' }}>
            <button onClick={() => decide('took_trade')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: '#4ade80', border: 'none', borderRadius: 8, color: '#080b14', cursor: 'pointer' }}>
              Take the trade anyway
            </button>
            <button onClick={() => decide('modified')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: 'transparent', border: '1px solid #f0c674', borderRadius: 8, color: '#f0c674', cursor: 'pointer' }}>
              Modify
            </button>
            <button onClick={() => decide('passed')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: 'rgba(248,113,113,0.15)', border: '1px solid #f87171', borderRadius: 8, color: '#f87171', cursor: 'pointer' }}>
              Pass
            </button>
            <button onClick={() => decide('deferred')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 700, background: 'transparent', border: '1px solid #888', borderRadius: 8, color: '#888', cursor: 'pointer' }}>
              Defer
            </button>
          </div>
        )}

        {totalCost != null && (
          <div style={{ marginTop: 12, fontSize: 10, color: '#555', textAlign: 'center' }}>
            Debate cost ${totalCost.toFixed(4)} · Moderator: Opus · Debaters: Sonnet
          </div>
        )}
      </div>
    </div>
  );
}

export default DebateModal;
