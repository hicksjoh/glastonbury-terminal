'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Radar, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Check, AlertTriangle } from 'lucide-react';

interface Signal {
  symbol: string;
  company: string;
  score: number;
  sources: string[];
  kellySizing: { shares: number; dollars: number; pctOfPortfolio: number };
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
  { key: 'confluence', label: 'Confluence', color: '#8a5cf6', desc: 'Cross-reference ALL signals' },
  { key: 'momentum', label: 'Momentum', color: '#4ade80', desc: 'Strong uptrends + volume' },
  { key: 'value', label: 'Value', color: '#22d3ee', desc: 'Undervalued + insider buying' },
  { key: 'income', label: 'Income', color: '#f0c674', desc: 'High yield + stable payouts' },
];

const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
  insider_buy: { bg: 'rgba(74,222,128,0.1)', color: '#4ade80' },
  cluster_buy: { bg: 'rgba(74,222,128,0.15)', color: '#4ade80' },
  congress_buy: { bg: 'rgba(138,92,246,0.1)', color: '#8a5cf6' },
  bullish_flow: { bg: 'rgba(34,211,238,0.1)', color: '#22d3ee' },
  positive_sentiment: { bg: 'rgba(240,198,116,0.1)', color: '#f0c674' },
  earnings_beat_history: { bg: 'rgba(248,113,113,0.1)', color: '#f87171' },
  above_50dma: { bg: 'rgba(255,255,255,0.05)', color: '#8888a8' },
  high_dividend: { bg: 'rgba(240,198,116,0.1)', color: '#f0c674' },
};

function getScoreColor(score: number): string {
  if (score >= 80) return '#4ade80';
  if (score >= 60) return '#f0c674';
  if (score >= 40) return '#22d3ee';
  return '#8888a8';
}

export default function ScannerPage() {
  const [data, setData] = useState<ScannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('confluence');
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchSignals = (p: string) => {
    setLoading(true);
    fetch(`/api/scanner?preset=${p}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSignals(preset); }, [preset]);

  useEffect(() => {
    const interval = setInterval(() => fetchSignals(preset), 300000);
    return () => clearInterval(interval);
  }, [preset]);

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Radar size={24} color="#c9a84c" />
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Signal Scanner</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {data && (
              <span style={{ color: '#555570', fontSize: 11 }}>
                Regime: <span style={{ color: '#f0c674', fontWeight: 600 }}>{data.marketRegime}</span>
              </span>
            )}
            <button onClick={() => fetchSignals(preset)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid #1e1e35',
              color: '#8888a8', fontSize: 12, cursor: 'pointer',
            }}><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Keisha finds trades for you &mdash; powered by multi-signal confluence</p>

        {/* Preset Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)} style={{
              padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
              background: preset === p.key ? `${p.color}15` : 'rgba(255,255,255,0.02)',
              border: `1px solid ${preset === p.key ? p.color : '#1e1e35'}`,
            }}>
              <div style={{ color: preset === p.key ? p.color : '#e8e8f0', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{p.label}</div>
              <div style={{ color: '#555570', fontSize: 11 }}>{p.desc}</div>
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Scanning for signals...</div>
        ) : !data || data.signals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>No signals found for this preset</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
            {data.signals.map(s => {
              const isExpanded = expanded === s.symbol;
              return (
                <div key={s.symbol} style={{
                  background: 'rgba(255,255,255,0.02)', borderRadius: 14, border: '1px solid #1e1e35',
                  overflow: 'hidden', transition: 'border-color 0.15s',
                  ...(isExpanded ? { borderColor: getScoreColor(s.score) + '50' } : {}),
                }}>
                  <div onClick={() => setExpanded(isExpanded ? null : s.symbol)} style={{ padding: '16px 18px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#e8e8f0', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s.symbol}</span>
                        <span style={{ color: '#555570', fontSize: 12 }}>{s.company}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: `${getScoreColor(s.score)}15`, border: `2px solid ${getScoreColor(s.score)}`,
                          color: getScoreColor(s.score), fontSize: 16, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace",
                        }}>{s.score}</div>
                        {isExpanded ? <ChevronUp size={16} color="#555570" /> : <ChevronDown size={16} color="#555570" />}
                      </div>
                    </div>

                    {/* Source Badges */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {s.sources.map(src => {
                        const st = SOURCE_COLORS[src] || { bg: 'rgba(255,255,255,0.05)', color: '#8888a8' };
                        return (
                          <span key={src} style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                            background: st.bg, color: st.color,
                          }}>{src.replace(/_/g, ' ')}</span>
                        );
                      })}
                      {s.regime_fit ? (
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(74,222,128,0.1)', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Check size={10} /> regime fit
                        </span>
                      ) : (
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(248,113,113,0.1)', color: '#f87171', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <AlertTriangle size={10} /> regime caution
                        </span>
                      )}
                    </div>

                    {/* Kelly Sizing */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                      <span style={{ color: '#22d3ee', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>Buy {s.kellySizing.shares} shares</span>
                      <span style={{ color: '#555570', fontSize: 12 }}>|</span>
                      <span style={{ color: '#f0c674', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>${s.kellySizing.dollars.toLocaleString()}</span>
                      <span style={{ color: '#555570', fontSize: 12 }}>|</span>
                      <span style={{ color: '#8888a8', fontSize: 12 }}>{s.kellySizing.pctOfPortfolio.toFixed(1)}% of portfolio</span>
                    </div>

                    <div style={{ color: '#8888a8', fontSize: 13, lineHeight: 1.5 }}>{s.thesis}</div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0 18px 16px', borderTop: '1px solid #1e1e35' }}>
                      <div style={{ paddingTop: 14, display: 'flex', gap: 8 }}>
                        <button onClick={() => { window.location.href = `/trading?symbol=${s.symbol}`; }} style={{
                          flex: 1, padding: '10px', borderRadius: 8, background: '#8a5cf6',
                          border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}><ExternalLink size={14} /> Send to Trading</button>
                        <button onClick={() => { window.location.href = `/keisha?query=Analyze ${s.symbol}`; }} style={{
                          flex: 1, padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)',
                          border: '1px solid #1e1e35', color: '#e8e8f0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        }}>Ask Keisha</button>
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
