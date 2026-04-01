'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { CalendarDays, TrendingUp, Zap, ChevronRight } from 'lucide-react';

interface EarningsEntry {
  symbol: string;
  company: string;
  date: string;
  time: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  surpriseHistory: { beatRate: number; avgSurprise: number; avgMoveOnEarnings: number };
  ivAnalysis: { currentIV: number | null; avgPostEarningsIV: number | null; crushEstimate: number | null; straddle_price: number | null };
  playRecommendation: string;
}

export default function EarningsPage() {
  const [data, setData] = useState<{ upcoming: EarningsEntry[]; thisWeek: number; highImpact: EarningsEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('this_week');
  const [selected, setSelected] = useState<EarningsEntry | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/earnings?range=${range}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <CalendarDays size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Earnings Intelligence</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Upcoming earnings &bull; surprise history &bull; IV analysis &bull; play recommendations</p>

        {/* Range Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[
            { key: 'this_week', label: 'This Week' },
            { key: 'next_week', label: 'Next Week' },
            { key: 'two_weeks', label: '2 Weeks' },
          ].map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${range === r.key ? '#c9a84c' : '#1e1e35'}`,
              background: range === r.key ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)',
              color: range === r.key ? '#c9a84c' : '#888',
            }}>{r.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555' }}>Loading earnings calendar...</div>
        ) : !data?.upcoming?.length ? (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 48, textAlign: 'center', color: '#555', fontSize: 13 }}>
            No earnings scheduled for this period
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 400px' : '1fr', gap: 20 }}>
            {/* Calendar/List */}
            <div>
              {/* High Impact Banner */}
              {data.highImpact.length > 0 && (
                <div style={{
                  background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)',
                  borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Zap size={16} color="#f87171" />
                  <span style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>
                    {data.highImpact.length} High Impact Earnings (avg move &gt;8%)
                  </span>
                  <span style={{ color: '#888', fontSize: 11 }}>
                    {data.highImpact.map(h => h.symbol).join(', ')}
                  </span>
                </div>
              )}

              {/* Earnings Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {data.upcoming.map((e, i) => (
                  <div
                    key={i}
                    onClick={() => setSelected(selected?.symbol === e.symbol ? null : e)}
                    style={{
                      background: selected?.symbol === e.symbol ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${selected?.symbol === e.symbol ? 'rgba(201,168,76,0.3)' : '#1e1e35'}`,
                      borderRadius: 10, padding: 16, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 700, color: '#e8e8f0', fontSize: 15, fontFamily: "'JetBrains Mono', monospace" }}>{e.symbol}</span>
                        <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>{e.company}</span>
                      </div>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: e.time === 'bmo' ? 'rgba(240,198,116,0.15)' : 'rgba(138,92,246,0.15)',
                        color: e.time === 'bmo' ? '#f0c674' : '#8a5cf6',
                      }}>{e.time === 'bmo' ? 'Pre-Market' : 'After Hours'}</span>
                    </div>

                    <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>{e.date}</div>

                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      {e.epsEstimate != null && (
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>EPS Est.</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                            ${e.epsEstimate.toFixed(2)}
                          </div>
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>Beat Rate</div>
                        <div style={{
                          fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                          color: e.surpriseHistory.beatRate >= 70 ? '#4ade80' : e.surpriseHistory.beatRate >= 50 ? '#f0c674' : '#f87171',
                        }}>{e.surpriseHistory.beatRate}%</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>Avg Move</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#22d3ee', fontFamily: "'JetBrains Mono', monospace" }}>
                          &plusmn;{e.surpriseHistory.avgMoveOnEarnings.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#888', fontSize: 11 }}>
                      <ChevronRight size={12} /> View details
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail Panel */}
            {selected && (
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                borderRadius: 12, padding: 20, position: 'sticky', top: 80, alignSelf: 'start',
              }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e8e8f0', margin: '0 0 4px', fontFamily: "'JetBrains Mono', monospace" }}>{selected.symbol}</h3>
                <p style={{ color: '#888', fontSize: 12, margin: '0 0 16px' }}>{selected.company} &mdash; {selected.date}</p>

                {/* Surprise History */}
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: "'JetBrains Mono', monospace" }}>Surprise History</h4>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {Array.from({ length: 8 }).map((_, i) => {
                      const isBeat = i < Math.round(selected.surpriseHistory.beatRate / 12.5);
                      return (
                        <div key={i} style={{
                          flex: 1, height: 32, borderRadius: 4,
                          background: isBeat ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)',
                          border: `1px solid ${isBeat ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ fontSize: 9, color: isBeat ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                            {isBeat ? 'BEAT' : 'MISS'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <StatCard label="Beat Rate" value={`${selected.surpriseHistory.beatRate}%`} color={selected.surpriseHistory.beatRate >= 70 ? '#4ade80' : '#f0c674'} />
                  <StatCard label="Avg Surprise" value={`${selected.surpriseHistory.avgSurprise > 0 ? '+' : ''}${selected.surpriseHistory.avgSurprise.toFixed(1)}%`} color="#22d3ee" />
                  <StatCard label="Avg Move" value={`\u00B1${selected.surpriseHistory.avgMoveOnEarnings.toFixed(1)}%`} color="#8a5cf6" />
                  <StatCard label="EPS Est." value={selected.epsEstimate ? `$${selected.epsEstimate.toFixed(2)}` : 'N/A'} color="#f0c674" />
                </div>

                {/* Play Recommendation */}
                <div style={{
                  background: 'rgba(138,92,246,0.06)', border: '1px solid rgba(138,92,246,0.2)',
                  borderRadius: 10, padding: '12px 16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <TrendingUp size={14} color="#8a5cf6" />
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#8a5cf6', textTransform: 'uppercase' }}>Play Recommendation</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#ccc', margin: 0, lineHeight: 1.5 }}>{selected.playRecommendation}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: `${color}08`, border: `1px solid ${color}15`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}
