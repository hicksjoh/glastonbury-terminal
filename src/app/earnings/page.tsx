'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { CalendarDays, TrendingUp, Zap, ChevronRight } from 'lucide-react';

interface EarningsEntry {
  symbol: string;
  company: string;
  date: string;
  time: 'bmo' | 'amc';
  epsEstimate: number;
  revenueEstimate: number;
  surpriseHistory: { beatRate: number; avgSurprise: number; avgMoveOnEarnings: number };
  ivAnalysis: { currentIV: number; avgPostEarningsIV: number; crushEstimate: number; straddle_price: number };
  playRecommendation: string;
}

interface EarningsData {
  upcoming: EarningsEntry[];
  thisWeek: number;
  highImpact: EarningsEntry[];
}

export default function EarningsPage() {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('this_week');
  const [selected, setSelected] = useState<EarningsEntry | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/earnings?range=${range}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  const getBeatColor = (rate: number) => rate >= 75 ? '#4ade80' : rate >= 50 ? '#f0c674' : '#f87171';

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <CalendarDays size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Earnings Intelligence</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Upcoming earnings, IV analysis, surprise history &amp; play recommendations</p>

        {/* Range Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[
            { key: 'this_week', label: 'This Week' },
            { key: 'next_week', label: 'Next Week' },
            { key: 'month', label: 'Next 30 Days' },
          ].map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: range === r.key ? 600 : 400,
              background: range === r.key ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${range === r.key ? '#8a5cf6' : '#1e1e35'}`,
              color: range === r.key ? '#8a5cf6' : '#8888a8',
            }}>{r.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Loading earnings calendar...</div>
        ) : !data ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Unable to load earnings data</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 20 }}>
            {/* Left: Calendar / List */}
            <div>
              {/* Stats Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                <div style={{ background: 'rgba(138,92,246,0.08)', border: '1px solid rgba(138,92,246,0.2)', borderRadius: 12, padding: 16 }}>
                  <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>This Week</div>
                  <div style={{ color: '#8a5cf6', fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{data.thisWeek}</div>
                </div>
                <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 12, padding: 16 }}>
                  <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Total Upcoming</div>
                  <div style={{ color: '#4ade80', fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{data.upcoming.length}</div>
                </div>
                <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 12, padding: 16 }}>
                  <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>High Impact</div>
                  <div style={{ color: '#f87171', fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{data.highImpact.length}</div>
                </div>
              </div>

              {/* High Impact Section */}
              {data.highImpact.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ color: '#f87171', fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Zap size={14} /> High Impact (avg move &gt;8%)
                  </h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {data.highImpact.map(e => (
                      <button key={e.symbol} onClick={() => setSelected(e)} style={{
                        padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                        background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                        color: '#f87171', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {e.symbol} ±{e.surpriseHistory.avgMoveOnEarnings.toFixed(1)}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Earnings Table */}
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                      {['Date', 'Symbol', 'Time', 'EPS Est', 'Beat Rate', 'Avg Move', 'IV Crush', ''].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '10px 12px', fontSize: 10, color: '#555570',
                          textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcoming.map(e => (
                      <tr key={`${e.symbol}-${e.date}`}
                        onClick={() => setSelected(e)}
                        style={{ borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer' }}
                        onMouseEnter={ev => (ev.currentTarget.style.background = '#1a1a2e')}
                        onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 12px', color: '#8888a8', fontSize: 12 }}>{e.date}</td>
                        <td style={{ padding: '10px 12px', color: '#e8e8f0', fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{e.symbol}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                            background: e.time === 'bmo' ? 'rgba(34,211,238,0.1)' : 'rgba(138,92,246,0.1)',
                            color: e.time === 'bmo' ? '#22d3ee' : '#8a5cf6',
                          }}>{e.time === 'bmo' ? 'Pre-Market' : 'After Close'}</span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#e8e8f0' }}>
                          ${e.epsEstimate?.toFixed(2) ?? 'N/A'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", color: getBeatColor(e.surpriseHistory.beatRate) }}>
                            {e.surpriseHistory.beatRate.toFixed(0)}%
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#f0c674' }}>
                          ±{e.surpriseHistory.avgMoveOnEarnings.toFixed(1)}%
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#22d3ee' }}>
                          {e.ivAnalysis.crushEstimate.toFixed(0)}%
                        </td>
                        <td style={{ padding: '10px 12px' }}><ChevronRight size={14} color="#555570" /></td>
                      </tr>
                    ))}
                    {data.upcoming.length === 0 && (
                      <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#555570', fontSize: 13 }}>No upcoming earnings for this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Detail Panel */}
            {selected && (
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{selected.symbol}</h2>
                    <p style={{ color: '#8888a8', fontSize: 13, margin: '4px 0 0' }}>{selected.company}</p>
                  </div>
                  <button onClick={() => setSelected(null)} style={{
                    padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)',
                    border: '1px solid #1e1e35', color: '#8888a8', fontSize: 11, cursor: 'pointer',
                  }}>Close</button>
                </div>

                {/* Earnings Date + Avg Move */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <div style={{ flex: 1, background: 'rgba(138,92,246,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Earnings Date</div>
                    <div style={{ color: '#8a5cf6', fontSize: 16, fontWeight: 700 }}>{selected.date}</div>
                    <div style={{ color: '#8888a8', fontSize: 11, marginTop: 2 }}>{selected.time === 'bmo' ? 'Before Market Open' : 'After Market Close'}</div>
                  </div>
                  <div style={{ flex: 1, background: 'rgba(240,198,116,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Avg Earnings Move</div>
                    <div style={{ color: '#f0c674', fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>±{selected.surpriseHistory.avgMoveOnEarnings.toFixed(1)}%</div>
                  </div>
                </div>

                {/* Surprise History */}
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Surprise History (Last 8 Quarters)</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <div style={{ background: 'rgba(74,222,128,0.08)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Beat Rate</div>
                      <div style={{ color: getBeatColor(selected.surpriseHistory.beatRate), fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{selected.surpriseHistory.beatRate.toFixed(0)}%</div>
                    </div>
                    <div style={{ background: 'rgba(34,211,238,0.08)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Avg Surprise</div>
                      <div style={{ color: '#22d3ee', fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{selected.surpriseHistory.avgSurprise >= 0 ? '+' : ''}{selected.surpriseHistory.avgSurprise.toFixed(1)}%</div>
                    </div>
                    <div style={{ background: 'rgba(138,92,246,0.08)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>EPS Estimate</div>
                      <div style={{ color: '#8a5cf6', fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>${selected.epsEstimate?.toFixed(2) ?? 'N/A'}</div>
                    </div>
                  </div>
                </div>

                {/* IV Analysis */}
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>IV Analysis</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Current IV</div>
                      <div style={{ color: '#e8e8f0', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{(selected.ivAnalysis.currentIV * 100).toFixed(1)}%</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Post-Earnings IV</div>
                      <div style={{ color: '#e8e8f0', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{(selected.ivAnalysis.avgPostEarningsIV * 100).toFixed(1)}%</div>
                    </div>
                    <div style={{ background: 'rgba(248,113,113,0.08)', borderRadius: 8, padding: 12 }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>IV Crush Estimate</div>
                      <div style={{ color: '#f87171', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{selected.ivAnalysis.crushEstimate.toFixed(0)}%</div>
                    </div>
                    <div style={{ background: 'rgba(240,198,116,0.08)', borderRadius: 8, padding: 12 }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>ATM Straddle</div>
                      <div style={{ color: '#f0c674', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>${selected.ivAnalysis.straddle_price.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                {/* Play Recommendation */}
                <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <TrendingUp size={16} color="#4ade80" />
                    <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>AI Play Recommendation</span>
                  </div>
                  <div style={{ color: '#e8e8f0', fontSize: 14, lineHeight: 1.6 }}>{selected.playRecommendation}</div>
                </div>

                <button onClick={() => { window.location.href = `/trading?symbol=${selected.symbol}&tab=options`; }} style={{
                  width: '100%', padding: '12px', marginTop: 16, borderRadius: 10,
                  background: '#8a5cf6', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>Trade {selected.symbol} Options</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
