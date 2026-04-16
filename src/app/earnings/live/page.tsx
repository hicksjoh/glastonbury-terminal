'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

const EARNINGS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_EARNINGS_COPILOT === 'true';

type Session = {
  id: string;
  ticker: string;
  call_date: string;
  quarter: string | null;
  status: 'scheduled' | 'live' | 'completed' | 'failed';
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<Session['status'], string> = {
  scheduled: '#f0c674',
  live: '#4ade80',
  completed: '#8a5cf6',
  failed: '#f87171',
};

function EarningsLiveList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/earnings/live/session');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setSessions(body.sessions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createSession = async () => {
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z.\-]{1,8}$/.test(sym)) { setError('Invalid ticker'); return; }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/earnings/live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sym }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Failed'); return; }
      router.push(`/earnings/live/${body.session.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>Live Earnings Co-Pilot</h1>
        <p style={{ fontSize: 13, color: '#888', margin: 0, marginBottom: 20 }}>
          Keisha attends the call. Live transcript, sentiment scoring, Q&A, post-call memo.
        </p>

        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: 16, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 20,
        }}>
          <input
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter' && !creating) createSession(); }}
            placeholder="Ticker (e.g. AAPL)"
            disabled={creating}
            style={{
              width: 140, padding: '10px 12px', fontSize: 16, fontWeight: 700,
              background: '#0a0a1a', color: '#e8e8e8',
              border: '1px solid #333', borderRadius: 8, fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          <button
            onClick={createSession}
            disabled={creating}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 700,
              background: 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
              border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
              opacity: creating ? 0.5 : 1,
            }}
          >
            {creating ? 'Starting…' : 'Start New Session'}
          </button>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Recent Sessions
          </div>
          {loading ? (
            <div style={{ color: '#666', fontSize: 12, padding: 20, textAlign: 'center' }}>Loading…</div>
          ) : sessions.length === 0 ? (
            <div style={{ color: '#666', fontSize: 12, padding: 20, textAlign: 'center' }}>
              No sessions yet. Start one above to attend a live earnings call.
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#555', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>When</th>
                  <th style={{ padding: '6px 8px' }}>Ticker</th>
                  <th style={{ padding: '6px 8px' }}>Quarter</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid #1a1a2a' }}>
                    <td style={{ padding: '8px', color: '#888' }}>
                      {new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px', color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{s.ticker}</td>
                    <td style={{ padding: '8px', color: '#aaa' }}>{s.quarter ?? '—'}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        padding: '1px 8px', borderRadius: 4,
                        background: `${STATUS_COLOR[s.status]}20`, color: STATUS_COLOR[s.status],
                        fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
                      }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      <button
                        onClick={() => router.push(`/earnings/live/${s.id}`)}
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
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, color: '#e8e8e8' }}>
            Earnings co-pilot disabled
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            Set <code style={{ color: '#f0c674', background: '#0a0a1a', padding: '2px 6px', borderRadius: 4 }}>NEXT_PUBLIC_FEATURE_EARNINGS_COPILOT=true</code> in <code style={{ color: '#f0c674' }}>.env.local</code> and restart.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return EARNINGS_ENABLED ? <EarningsLiveList /> : <DisabledNotice />;
}
