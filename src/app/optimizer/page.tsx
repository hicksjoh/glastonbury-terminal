'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Target } from 'lucide-react';

interface OptimizeResult {
  currentWeights: { [symbol: string]: number };
  optimalWeights: { [symbol: string]: number };
  changes: { symbol: string; current: number; optimal: number; action: string }[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
  frontier: { risk: number; return: number; sharpe: number }[];
  aiViews: { symbol: string; view: string; confidence: number; reasoning: string }[];
  rebalanceInstructions: string;
}

const COLORS = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
};

const SYMBOL_COLORS = [
  '#8a5cf6', '#22d3ee', '#f0c674', '#4ade80', '#f87171',
  '#fb923c', '#a78bfa', '#67e8f9', '#fbbf24', '#86efac',
];

const RISK_LABELS = ['', 'Conservative', 'Moderate-Conservative', 'Moderate', 'Moderate-Aggressive', 'Aggressive'];

const mono: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

export default function OptimizerPage() {
  const [riskAversion, setRiskAversion] = useState(3);
  const [useAIViews, setUseAIViews] = useState(true);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const optimize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useAIViews, riskAversion }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Optimization failed');
    } finally {
      setLoading(false);
    }
  };

  const actionColor = (action: string) => {
    switch (action) {
      case 'INCREASE': return COLORS.green;
      case 'DECREASE': return COLORS.red;
      case 'ADD': return COLORS.cyan;
      case 'REMOVE': return COLORS.gold;
      default: return '#8888a8';
    }
  };

  const viewBadgeStyle = (view: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
    };
    if (view === 'bullish') return { ...base, background: 'rgba(74,222,128,0.15)', color: COLORS.green };
    if (view === 'bearish') return { ...base, background: 'rgba(248,113,113,0.15)', color: COLORS.red };
    return { ...base, background: 'rgba(136,136,168,0.15)', color: '#8888a8' };
  };

  return (
    <AppShell>
      <ErrorBoundary label="Optimizer">
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Target size={28} color={COLORS.purple} />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Portfolio Optimizer</h1>
        </div>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>
          Optimize your portfolio allocation using Modern Portfolio Theory
        </p>

        {/* Controls */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20,
          padding: 20, background: COLORS.surface, borderRadius: 12,
          border: `1px solid ${COLORS.border}`, marginBottom: 28,
        }}>
          <button
            onClick={optimize}
            disabled={loading}
            style={{
              padding: '10px 24px', background: COLORS.purple, color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Optimizing...' : 'Optimize Portfolio'}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ color: '#8888a8', fontSize: 12, fontWeight: 500 }}>
              Risk Aversion: <span style={{ color: COLORS.gold, ...mono }}>{riskAversion}</span> — {RISK_LABELS[riskAversion]}
            </label>
            <input
              type="range" min={1} max={5} step={1}
              value={riskAversion}
              onChange={(e) => setRiskAversion(Number(e.target.value))}
              style={{ width: 200, accentColor: COLORS.purple }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666' }}>
              <span>Conservative</span><span>Aggressive</span>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div
              onClick={() => setUseAIViews(!useAIViews)}
              style={{
                width: 40, height: 22, borderRadius: 11,
                background: useAIViews ? COLORS.purple : '#333',
                position: 'relative', transition: 'background 0.2s', cursor: 'pointer',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: useAIViews ? 21 : 3, transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ color: '#ccc', fontSize: 13 }}>Use AI Views</span>
          </label>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: 16, background: 'rgba(248,113,113,0.1)', border: `1px solid ${COLORS.red}`,
            borderRadius: 8, color: COLORS.red, marginBottom: 20, fontSize: 14,
          }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{
              width: 40, height: 40, border: `3px solid ${COLORS.border}`,
              borderTopColor: COLORS.purple, borderRadius: '50%',
              margin: '0 auto 16px',
              animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: '#8888a8', fontSize: 14 }}>Running portfolio optimization...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Before optimization */}
        {!loading && !data && !error && (
          <div style={{
            textAlign: 'center', padding: 80,
            background: COLORS.surface, borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
          }}>
            <Target size={48} color={COLORS.border} style={{ marginBottom: 16 }} />
            <p style={{ color: '#8888a8', fontSize: 16 }}>Click Optimize to analyze your portfolio</p>
          </div>
        )}

        {/* After optimization */}
        {!loading && data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Expected Return', value: data.expectedReturn, color: COLORS.green, suffix: '%' },
                { label: 'Expected Risk', value: data.expectedRisk, color: COLORS.gold, suffix: '%' },
                { label: 'Sharpe Ratio', value: data.sharpeRatio, color: COLORS.cyan, suffix: '' },
              ].map((stat) => (
                <div key={stat.label} style={{
                  padding: 20, background: COLORS.surface, borderRadius: 12,
                  border: `1px solid ${COLORS.border}`, textAlign: 'center',
                }}>
                  <div style={{ color: '#8888a8', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: stat.color, ...mono }}>
                    {stat.value.toFixed(2)}{stat.suffix}
                  </div>
                </div>
              ))}
            </div>

            {/* Side-by-side Weights */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { title: 'Current Weights', weights: data.currentWeights },
                { title: 'Optimal Weights', weights: data.optimalWeights },
              ].map(({ title, weights }) => {
                const symbols = Object.keys(weights);
                return (
                  <div key={title} style={{
                    padding: 20, background: COLORS.surface, borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                  }}>
                    <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>{title}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {symbols.map((sym, i) => (
                        <div key={sym}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ color: '#ccc', fontSize: 13 }}>{sym}</span>
                            <span style={{ color: '#8888a8', fontSize: 13, ...mono }}>
                              {(weights[sym] * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div style={{
                            height: 8, background: COLORS.border, borderRadius: 4, overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${Math.min(weights[sym] * 100, 100)}%`,
                              height: '100%',
                              background: SYMBOL_COLORS[i % SYMBOL_COLORS.length],
                              borderRadius: 4,
                              transition: 'width 0.5s ease',
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Changes Table */}
            <div style={{
              padding: 20, background: COLORS.surface, borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Rebalance Changes</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Current %', 'Optimal %', 'Action'].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '8px 12px', color: '#8888a8',
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
                        borderBottom: `1px solid ${COLORS.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.changes.map((c) => (
                    <tr key={c.symbol} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: '10px 12px', color: '#fff', fontWeight: 600, fontSize: 14 }}>{c.symbol}</td>
                      <td style={{ padding: '10px 12px', color: '#ccc', ...mono, fontSize: 13 }}>
                        {(c.current * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '10px 12px', color: '#ccc', ...mono, fontSize: 13 }}>
                        {(c.optimal * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          color: actionColor(c.action), fontWeight: 600, fontSize: 12,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          {c.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* AI Views */}
            {data.aiViews && data.aiViews.length > 0 && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>AI Market Views</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                  {data.aiViews.map((v) => (
                    <div key={v.symbol} style={{
                      padding: 16, background: COLORS.surface, borderRadius: 10,
                      border: `1px solid ${COLORS.border}`,
                      borderLeft: `4px solid ${COLORS.purple}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{v.symbol}</span>
                        <span style={viewBadgeStyle(v.view)}>{v.view}</span>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: '#8888a8', fontSize: 11 }}>Confidence</span>
                          <span style={{ color: '#ccc', fontSize: 11, ...mono }}>{(v.confidence * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 6, background: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${v.confidence * 100}%`, height: '100%',
                            background: COLORS.purple, borderRadius: 3,
                          }} />
                        </div>
                      </div>
                      <p style={{ color: '#8888a8', fontSize: 12, lineHeight: 1.5, margin: 0 }}>{v.reasoning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Efficient Frontier */}
            {data.frontier && data.frontier.length > 0 && (
              <div style={{
                padding: 20, background: COLORS.surface, borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
              }}>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>Efficient Frontier</h3>
                {(() => {
                  const risks = data.frontier.map((p) => p.risk);
                  const returns = data.frontier.map((p) => p.return);
                  const minR = Math.min(...risks);
                  const maxR = Math.max(...risks);
                  const minRet = Math.min(...returns);
                  const maxRet = Math.max(...returns);
                  const rangeR = maxR - minR || 1;
                  const rangeRet = maxRet - minRet || 1;
                  const chartW = 100; // percent
                  const chartH = 300;

                  const scaleX = (v: number) => ((v - minR) / rangeR) * 90 + 5;
                  const scaleY = (v: number) => chartH - ((v - minRet) / rangeRet) * (chartH - 40) - 20;

                  // Find the optimal point (highest sharpe)
                  const optIdx = data.frontier.reduce((best, p, i) =>
                    p.sharpe > data.frontier[best].sharpe ? i : best, 0);

                  return (
                    <div style={{ position: 'relative', width: `${chartW}%`, height: chartH, overflow: 'visible' }}>
                      {/* Y axis label */}
                      <div style={{
                        position: 'absolute', left: -8, top: '50%', transform: 'rotate(-90deg) translateX(50%)',
                        color: '#8888a8', fontSize: 10, whiteSpace: 'nowrap',
                      }}>Return %</div>
                      {/* X axis label */}
                      <div style={{
                        position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
                        color: '#8888a8', fontSize: 10,
                      }}>Risk %</div>
                      {/* Grid lines */}
                      {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
                        <div key={pct} style={{
                          position: 'absolute', left: '5%', right: '5%',
                          top: 20 + pct * (chartH - 40),
                          borderBottom: `1px solid ${COLORS.border}`,
                        }}>
                          <span style={{
                            position: 'absolute', left: -32, top: -6,
                            color: '#666', fontSize: 9, ...mono,
                          }}>
                            {(maxRet - pct * rangeRet).toFixed(1)}
                          </span>
                        </div>
                      ))}
                      {/* Frontier dots */}
                      {data.frontier.map((p, i) => (
                        <div key={i} style={{
                          position: 'absolute',
                          left: `${scaleX(p.risk)}%`,
                          top: scaleY(p.return),
                          width: i === optIdx ? 14 : 8,
                          height: i === optIdx ? 14 : 8,
                          borderRadius: '50%',
                          background: i === optIdx ? COLORS.green : COLORS.purple,
                          border: i === optIdx ? `2px solid #fff` : 'none',
                          transform: 'translate(-50%, -50%)',
                          zIndex: i === optIdx ? 2 : 1,
                          cursor: 'default',
                        }}
                          title={`Risk: ${p.risk.toFixed(2)}%, Return: ${p.return.toFixed(2)}%, Sharpe: ${p.sharpe.toFixed(2)}`}
                        />
                      ))}
                      {/* Current portfolio marker */}
                      {data.expectedRisk !== undefined && data.expectedReturn !== undefined && (
                        <div style={{
                          position: 'absolute',
                          left: `${scaleX(data.expectedRisk)}%`,
                          top: scaleY(data.expectedReturn),
                          width: 14, height: 14,
                          borderRadius: '50%',
                          background: 'transparent',
                          border: `2px solid ${COLORS.gold}`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 3,
                        }}
                          title={`Optimal: Risk ${data.expectedRisk.toFixed(2)}%, Return ${data.expectedReturn.toFixed(2)}%`}
                        />
                      )}
                      {/* Legend */}
                      <div style={{
                        position: 'absolute', top: 4, right: 8,
                        display: 'flex', gap: 16, fontSize: 10, color: '#8888a8',
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.purple, display: 'inline-block' }} />
                          Frontier
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.green, border: '2px solid #fff', display: 'inline-block' }} />
                          Best Sharpe
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${COLORS.gold}`, display: 'inline-block' }} />
                          Optimal
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Rebalance Instructions */}
            {data.rebalanceInstructions && (
              <div style={{
                padding: 20, background: COLORS.surface, borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
              }}>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Rebalance Instructions</h3>
                <pre style={{
                  color: '#ccc', fontSize: 13, lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  margin: 0, ...mono,
                }}>
                  {data.rebalanceInstructions}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
