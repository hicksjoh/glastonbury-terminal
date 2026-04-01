'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Radar, RefreshCw, ChevronDown, ChevronUp, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react';

interface Signal {
  symbol: string;
  company: string;
  score: number;
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number } | null;
  thesis: string;
  regime_fit: boolean;
}

interface ScannerData {
  signals: Signal[];
  preset: string;
  timestamp: string;
  marketRegime: string;
}

const PRESETS = [
  { key: 'confluence', label: 'Confluence', color: '#c9a84c', desc: 'Cross-signal alpha' },
  { key: 'momentum', label: 'Momentum', color: '#4ade80', desc: 'Price + volume breakouts' },
  { key: 'value', label: 'Value', color: '#22d3ee', desc: 'Low P/E + catalysts' },
  { key: 'income', label: 'Income', color: '#f0c674', desc: 'High yield + ex-div' },
];

export default function ScannerPage() {
  const [data, setData] = useState<ScannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('confluence');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scanner?preset=${preset}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Scanner error:', err);
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 300000); // 5 min
    return () => clearInterval(interval);
  }, [fetchSignals]);

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#4ade80';
    if (score >= 50) return '#f0c674';
    if (score >= 30) return '#f97316';
    return '#f87171';
  };

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Radar size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Signal Scanner</h1>
          <button onClick={fetchSignals} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a3a',
            background: 'rgba(255,255,255,0.03)', color: '#888', fontSize: 12, cursor: 'pointer',
          }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Scan
          </button>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>
          Keisha finds trades for you &bull; confluence scoring &bull; Kelly-sized positions
          {data?.marketRegime && (
            <span style={{ marginLeft: 12, padding: '2px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(138,92,246,0.15)', color: '#8a5cf6' }}>
              Regime: {data.marketRegime.replace('_', ' ')}
            </span>
          )}
        </p>

        {/* Preset Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              style={{
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${preset === p.key ? p.color : '#1e1e35'}`,
                background: preset === p.key ? `${p.color}10` : 'rgba(255,255,255,0.02)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: preset === p.key ? p.color : '#ccc', marginBottom: 2 }}>{p.label}</div>
              <div style={{ fontSize: 10, color: '#666' }}>{p.desc}</div>
            </button>
          ))}
        </div>

        {/* Signal Cards */}
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555' }}>Scanning for signals...</div>
        ) : !data?.signals?.length ? (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 48, textAlign: 'center', color: '#555', fontSize: 13 }}>
            No signals found for {preset} preset. Try a different scan.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {data.signals.map((s, i) => {
              const expanded = expandedSymbol === s.symbol;
              return (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255,255,255,0.02)', border: `1px solid ${expanded ? getScoreColor(s.score) + '40' : '#1e1e35'}`,
                    borderRadius: 12, overflow: 'hidden', transition: 'all 0.15s',
                  }}
                >
                  {/* Card Header */}
                  <div
                    onClick={() => setExpandedSymbol(expanded ? null : s.symbol)}
                    style={{ padding: 16, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div>
                        <span style={{ fontWeight: 700, color: '#e8e8f0', fontSize: 16, fontFamily: "'JetBrains Mono', monospace" }}>{s.symbol}</span>
                        <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>{s.company}</span>
                      </div>
                      {/* Score Badge */}
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `${getScoreColor(s.score)}15`, border: `2px solid ${getScoreColor(s.score)}`,
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: getScoreColor(s.score), fontFamily: "'JetBrains Mono', monospace" }}>{s.score}</span>
                      </div>
                    </div>

                    {/* Source Badges */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {s.sources.map(src => (
                        <span key={src} style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                          background: 'rgba(138,92,246,0.1)', color: '#a78bfa',
                          textTransform: 'uppercase',
                        }}>{src.replace(/_/g, ' ')}</span>
                      ))}
                    </div>

                    {/* Kelly Sizing */}
                    {s.kellySizing && (
                      <div style={{ fontSize: 12, color: '#f0c674', fontWeight: 600, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                        Buy {s.kellySizing.shares} shares (${s.kellySizing.dollars.toLocaleString()}) &mdash; {s.kellySizing.pctOfPortfolio}%
                      </div>
                    )}

                    {/* Thesis */}
                    <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.4 }}>{s.thesis}</div>

                    {/* Regime Fit */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                      {s.regime_fit ? (
                        <>
                          <CheckCircle size={12} color="#4ade80" />
                          <span style={{ fontSize: 10, color: '#4ade80' }}>Regime fit</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={12} color="#f0c674" />
                          <span style={{ fontSize: 10, color: '#f0c674' }}>Regime mismatch</span>
                        </>
                      )}
                      {expanded ? <ChevronUp size={14} color="#666" style={{ marginLeft: 'auto' }} /> : <ChevronDown size={14} color="#666" style={{ marginLeft: 'auto' }} />}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {expanded && (
                    <div style={{
                      padding: '12px 16px 16px', borderTop: '1px solid #1e1e35',
                      background: 'rgba(255,255,255,0.01)',
                    }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => window.location.href = `/trading?symbol=${s.symbol}`}
                          style={{
                            flex: 1, padding: '8px 16px', borderRadius: 8,
                            background: '#8a5cf6', border: 'none', color: '#fff',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}
                        >
                          <ExternalLink size={12} /> Send to Trading
                        </button>
                        <button
                          onClick={() => window.location.href = `/keisha?q=Analyze+${s.symbol}+signal`}
                          style={{
                            flex: 1, padding: '8px 16px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2a3a',
                            color: '#ccc', fontSize: 12, cursor: 'pointer',
                          }}
                        >
                          Ask Keisha
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
