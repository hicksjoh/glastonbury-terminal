'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import MarkdownRenderer from '@/components/MarkdownRenderer';

const FEATURE = process.env.NEXT_PUBLIC_FEATURE_COACH === 'true';

type Pattern = { type: string; evidence: string; severity: 'low' | 'medium' | 'high' };

type Review = {
  id: string;
  week_of: string;
  review_markdown: string;
  patterns_detected: Pattern[] | null;
  primary_rule_for_next_week: string | null;
  trade_count: number | null;
  pnl_usd: number | null;
  created_at: string;
};

const SEVERITY_COLOR: Record<Pattern['severity'], string> = {
  low: '#f0c674', medium: '#f97316', high: '#f87171',
};

function CoachPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/list');
      const body = await res.json();
      setReviews(body.reviews ?? []);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/run', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Run failed');
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setRunning(false); }
  };

  const latest = reviews[0];

  // Pattern counts over all weeks
  const patternCounts: Record<string, number> = {};
  for (const r of reviews) {
    for (const p of r.patterns_detected ?? []) {
      patternCounts[p.type] = (patternCounts[p.type] ?? 0) + 1;
    }
  }
  const sortedPatternCounts = Object.entries(patternCounts).sort(([, a], [, b]) => b - a);

  return (
    <AppShell>
      <div style={{ minHeight: '100vh', padding: '16px 0', color: '#e8e8e8' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 6 }}>Behavioral Coach</h1>
        <p style={{ fontSize: 13, color: '#888', margin: 0, marginBottom: 20 }}>
          Weekly review of trades + journal. Flags revenge trades, FOMO chases, size creep, Friday YOLOs.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={runNow}
            disabled={running}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 700,
              background: running ? 'rgba(138,92,246,0.2)' : 'linear-gradient(135deg, #8a5cf6, #6b3fc4)',
              border: 'none', borderRadius: 8, color: '#fff', cursor: running ? 'wait' : 'pointer',
              opacity: running ? 0.7 : 1,
            }}
          >
            {running ? 'Reviewing…' : 'Run Review Now'}
          </button>
          <span style={{ fontSize: 12, color: '#888' }}>
            Runs automatically every Sunday at 6pm PT
          </span>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#2a1010', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, color: '#666', textAlign: 'center' }}>Loading…</div>
        ) : reviews.length === 0 ? (
          <div style={{ padding: 40, color: '#666', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
            No reviews yet. Hit Run Review Now.
          </div>
        ) : (
          <>
            {/* Latest review — full render */}
            {latest && (
              <div style={{ padding: 18, background: 'rgba(138,92,246,0.06)', border: '2px solid #8a5cf6', borderRadius: 14, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8a5cf6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Latest Review · Week of {latest.week_of}
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#888', marginTop: 3 }}>
                      <span>{latest.trade_count ?? 0} trades</span>
                      <span>·</span>
                      <span style={{ color: (latest.pnl_usd ?? 0) >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                        {(latest.pnl_usd ?? 0) >= 0 ? '+' : ''}${(latest.pnl_usd ?? 0).toFixed(0)} P&L
                      </span>
                    </div>
                  </div>
                </div>

                {latest.primary_rule_for_next_week && (
                  <div style={{ padding: 14, background: 'rgba(240,198,116,0.08)', borderLeft: '4px solid #f0c674', borderRadius: 8, marginBottom: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      Rule for next week
                    </div>
                    <div style={{ fontSize: 14, color: '#e8e8e8', fontWeight: 600 }}>
                      {latest.primary_rule_for_next_week}
                    </div>
                  </div>
                )}

                {latest.patterns_detected && latest.patterns_detected.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      Patterns Detected ({latest.patterns_detected.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {latest.patterns_detected.map((p, i) => (
                        <div key={i} style={{ padding: 10, borderRadius: 8, background: `${SEVERITY_COLOR[p.severity]}14`, border: `1px solid ${SEVERITY_COLOR[p.severity]}40` }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: SEVERITY_COLOR[p.severity], color: '#080b14', fontWeight: 700, textTransform: 'uppercase' }}>
                              {p.severity}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace" }}>
                              {p.type}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: '#d0d0e0', lineHeight: 1.4 }}>
                            {p.evidence}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <MarkdownRenderer content={latest.review_markdown} compact />
              </div>
            )}

            {/* Pattern-detection graph over time (bars) */}
            {sortedPatternCounts.length > 0 && (
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  Pattern Frequency · All Weeks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sortedPatternCounts.map(([type, count]) => {
                    const maxCount = sortedPatternCounts[0][1];
                    const pct = (count / maxCount) * 100;
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 180, fontSize: 11, color: '#aaa', fontFamily: "'JetBrains Mono', monospace" }}>{type}</div>
                        <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #8a5cf6, #f0c674)' }} />
                        </div>
                        <div style={{ width: 30, fontSize: 11, color: '#e8e8e8', fontWeight: 700, textAlign: 'right' }}>{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Older reviews timeline */}
            {reviews.length > 1 && (
              <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(138,92,246,0.1)', borderRadius: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  Previous Reviews
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reviews.slice(1).map(r => (
                    <details key={r.id} style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                        <span style={{ color: '#e8e8e8', fontWeight: 700 }}>Week of {r.week_of}</span>
                        <span style={{ color: '#666', marginLeft: 10 }}>
                          {r.trade_count ?? 0} trades ·{' '}
                          <span style={{ color: (r.pnl_usd ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
                            {(r.pnl_usd ?? 0) >= 0 ? '+' : ''}${(r.pnl_usd ?? 0).toFixed(0)}
                          </span>
                          {r.patterns_detected && r.patterns_detected.length > 0 && (
                            <span style={{ marginLeft: 10, color: '#f0c674' }}>
                              {r.patterns_detected.length} pattern(s)
                            </span>
                          )}
                        </span>
                      </summary>
                      {r.primary_rule_for_next_week && (
                        <div style={{ padding: 8, marginTop: 8, background: 'rgba(240,198,116,0.06)', borderLeft: '2px solid #f0c674', fontSize: 12, color: '#d0d0e0' }}>
                          {r.primary_rule_for_next_week}
                        </div>
                      )}
                      <div style={{ marginTop: 8 }}>
                        <MarkdownRenderer content={r.review_markdown} compact />
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function DisabledNotice() {
  return <AppShell><div style={{ padding: 40, color: '#888' }}>Coach disabled. Set NEXT_PUBLIC_FEATURE_COACH=true.</div></AppShell>;
}

export default function Page() {
  return FEATURE ? <CoachPage /> : <DisabledNotice />;
}
