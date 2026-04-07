'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import { Activity, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Flow {
  symbol: string;
  contractType: string;
  strike: number;
  expiration: string;
  premium: number;
  volume: number;
  openInterest: number;
  volOiRatio: number;
  sentiment: string;
  flowType: 'sweep' | 'block' | 'unusual';
  direction: 'bullish' | 'bearish';
  timestamp: string;
}

interface FlowData {
  flows: Flow[];
  summary: { totalFlows: number; bullishPct: number; bearishPct: number; topSymbols: string[] };
}

export default function FlowPage() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [minPremium, setMinPremium] = useState(100000);
  const [minVolOI, setMinVolOI] = useState(3);
  const [typeFilter, setTypeFilter] = useState('');

  const fetchFlow = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        minPremium: String(minPremium),
        minVolOI: String(minVolOI),
      });
      if (typeFilter) params.set('type', typeFilter);
      const res = await fetch(`/api/flow?${params}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Flow fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [minPremium, minVolOI, typeFilter]);

  useEffect(() => {
    fetchFlow();
    const interval = setInterval(fetchFlow, 60000);
    return () => clearInterval(interval);
  }, [fetchFlow]);

  const formatPremium = (n: number) => {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
    return `$${n}`;
  };

  return (
    <AppShell>
      <ErrorBoundary label="Flow">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Activity size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Options Flow</h1>
          <button
            onClick={fetchFlow}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a3a',
              background: 'rgba(255,255,255,0.03)', color: '#888', fontSize: 12, cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Unusual options activity &bull; sweeps, blocks, volume anomalies</p>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#666', fontSize: 11 }}>MIN PREMIUM</span>
            <select
              value={minPremium}
              onChange={e => setMinPremium(Number(e.target.value))}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid #2a2a3a',
                background: '#1a1a24', color: '#e8e8e8', fontSize: 12,
              }}
            >
              <option value={50000}>$50K</option>
              <option value={100000}>$100K</option>
              <option value={250000}>$250K</option>
              <option value={500000}>$500K</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#666', fontSize: 11 }}>VOL/OI</span>
            <select
              value={minVolOI}
              onChange={e => setMinVolOI(Number(e.target.value))}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid #2a2a3a',
                background: '#1a1a24', color: '#e8e8e8', fontSize: 12,
              }}
            >
              <option value={2}>2x+</option>
              <option value={3}>3x+</option>
              <option value={5}>5x+</option>
              <option value={10}>10x+</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['', 'sweep', 'block', 'unusual'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${typeFilter === t ? '#c9a84c' : '#2a2a3a'}`,
                  background: typeFilter === t ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)',
                  color: typeFilter === t ? '#c9a84c' : '#888',
                  textTransform: 'capitalize',
                }}
              >
                {t || 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        {data?.summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <SummaryCard label="Total Flows" value={String(data.summary.totalFlows)} color="#8a5cf6" />
            <SummaryCard label="Bullish" value={`${data.summary.bullishPct}%`} color="#4ade80" />
            <SummaryCard label="Bearish" value={`${data.summary.bearishPct}%`} color="#f87171" />
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
              borderRadius: 10, padding: 14,
            }}>
              <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>Top Symbols</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {data.summary.topSymbols.map(s => (
                  <span key={s} style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                    background: 'rgba(201,168,76,0.1)', color: '#c9a84c',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Flow Table */}
        {loading && !data ? (
          <LoadingState />
        ) : !data?.flows?.length ? (
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
            borderRadius: 12, padding: 48, textAlign: 'center', color: '#555', fontSize: 13,
          }}>No unusual flow detected with current filters. Try lowering thresholds.</div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                  {['Symbol', 'Type', 'C/P', 'Strike', 'Exp', 'Premium', 'Vol/OI', 'Flow', 'Direction', 'Sentiment'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 10px', fontSize: 10, color: '#555',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.flows.map((f, i) => (
                  <tr
                    key={i}
                    onClick={() => window.location.href = `/trading?symbol=${f.symbol}&tab=options`}
                    style={{
                      borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer',
                      background: f.direction === 'bullish' ? 'rgba(74,222,128,0.02)' : 'rgba(248,113,113,0.02)',
                    }}
                  >
                    <td style={{ padding: '10px', color: '#e8e8f0', fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{f.symbol}</td>
                    <td style={{ padding: '10px' }}>
                      <FlowBadge type={f.flowType} />
                    </td>
                    <td style={{ padding: '10px', color: f.contractType === 'call' ? '#4ade80' : '#f87171', fontSize: 12, textTransform: 'uppercase', fontWeight: 600 }}>{f.contractType}</td>
                    <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#ccc' }}>${f.strike}</td>
                    <td style={{ padding: '10px', fontSize: 12, color: '#888' }}>{f.expiration}</td>
                    <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#f0c674', fontWeight: 600 }}>{formatPremium(f.premium)}</td>
                    <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: f.volOiRatio > 5 ? '#f0c674' : '#ccc' }}>{f.volOiRatio.toFixed(1)}x</td>
                    <td style={{ padding: '10px' }}>
                      <FlowBadge type={f.flowType} />
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
                        color: f.direction === 'bullish' ? '#4ade80' : '#f87171',
                      }}>
                        {f.direction === 'bullish' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {f.direction}
                      </span>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10,
                        background: f.sentiment === 'positive' ? 'rgba(74,222,128,0.1)' : f.sentiment === 'negative' ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)',
                        color: f.sentiment === 'positive' ? '#4ade80' : f.sentiment === 'negative' ? '#f87171' : '#888',
                      }}>{f.sentiment}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: `${color}08`, border: `1px solid ${color}20`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function FlowBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    sweep: { bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
    block: { bg: 'rgba(138,92,246,0.15)', color: '#8a5cf6' },
    unusual: { bg: 'rgba(240,198,116,0.15)', color: '#f0c674' },
  };
  const c = colors[type] || colors.unusual;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.color, textTransform: 'uppercase',
    }}>{type}</span>
  );
}
