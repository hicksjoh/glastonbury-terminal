'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FlaskConical, Plus, Trash2, Play } from 'lucide-react';

interface Leg {
  id: string;
  symbol: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  side: 'long' | 'short';
  quantity: number;
}

interface GridPoint {
  price: number;
  dte: number;
  pnl: number;
  delta: number;
  theta: number;
  gamma: number;
}

interface SimResult {
  grid: GridPoint[];
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  probabilityOfProfit: number;
}

const TEMPLATES: { name: string; legs: Omit<Leg, 'id' | 'symbol' | 'expiration'>[] }[] = [
  { name: 'Long Call', legs: [{ strike: 100, type: 'call', side: 'long', quantity: 1 }] },
  { name: 'Covered Call', legs: [{ strike: 105, type: 'call', side: 'short', quantity: 1 }] },
  { name: 'Bull Call Spread', legs: [{ strike: 95, type: 'call', side: 'long', quantity: 1 }, { strike: 105, type: 'call', side: 'short', quantity: 1 }] },
  { name: 'Iron Condor', legs: [
    { strike: 90, type: 'put', side: 'long', quantity: 1 },
    { strike: 95, type: 'put', side: 'short', quantity: 1 },
    { strike: 105, type: 'call', side: 'short', quantity: 1 },
    { strike: 110, type: 'call', side: 'long', quantity: 1 },
  ]},
  { name: 'Straddle', legs: [{ strike: 100, type: 'call', side: 'long', quantity: 1 }, { strike: 100, type: 'put', side: 'long', quantity: 1 }] },
  { name: 'Butterfly', legs: [
    { strike: 95, type: 'call', side: 'long', quantity: 1 },
    { strike: 100, type: 'call', side: 'short', quantity: 2 },
    { strike: 105, type: 'call', side: 'long', quantity: 1 },
  ]},
];

function createLeg(): Leg {
  const d = new Date(); d.setDate(d.getDate() + 30);
  return { id: Date.now().toString(), symbol: 'AAPL', strike: 100, expiration: d.toISOString().split('T')[0], type: 'call', side: 'long', quantity: 1 };
}

function getPnlColor(pnl: number, maxP: number, maxL: number): string {
  if (pnl > 0) {
    const i = Math.min(pnl / (maxP || 1), 1);
    return `rgba(74, 222, 128, ${0.1 + i * 0.6})`;
  }
  const i = Math.min(Math.abs(pnl) / (Math.abs(maxL) || 1), 1);
  return `rgba(248, 113, 113, ${0.1 + i * 0.6})`;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 6, fontSize: 12,
  background: '#0a0a1a', border: '1px solid #1e1e35',
  color: '#e8e8f0', outline: 'none', fontFamily: "'JetBrains Mono', monospace",
};

export default function SimulatorPage() {
  const [legs, setLegs] = useState<Leg[]>([createLeg()]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ivChange, setIvChange] = useState(0);
  const [viewMode, setViewMode] = useState<'heatmap' | 'expiry'>('heatmap');

  const addLeg = () => setLegs([...legs, createLeg()]);
  const removeLeg = (id: string) => setLegs(legs.filter(l => l.id !== id));
  const updateLeg = (id: string, field: keyof Leg, value: string | number) => {
    setLegs(legs.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    const sym = legs[0]?.symbol || 'AAPL';
    const exp = legs[0]?.expiration || createLeg().expiration;
    setLegs(t.legs.map((l, i) => ({ ...l, id: Date.now().toString() + i, symbol: sym, expiration: exp })));
  };

  const runSimulation = async () => {
    setLoading(true);
    try {
      const strikes = legs.map(l => l.strike);
      const mid = strikes.reduce((a, b) => a + b, 0) / strikes.length;
      const res = await fetch('/api/options-sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legs: legs.map(({ symbol, strike, expiration, type, side, quantity }) => ({ symbol, strike, expiration, type, side, quantity })),
          priceRange: { min: mid * 0.8, max: mid * 1.2, step: mid * 0.02 },
          dteRange: { current: 30, simDays: 30 },
          ivChange,
        }),
      });
      const d = await res.json();
      if (!d.error) setResult(d);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const heatmapData = result ? (() => {
    const dtes = Array.from(new Set(result.grid.map(g => g.dte))).sort((a, b) => b - a);
    const prices = Array.from(new Set(result.grid.map(g => g.price))).sort((a, b) => a - b);
    const map = new Map<string, GridPoint>();
    result.grid.forEach(g => map.set(`${g.price}-${g.dte}`, g));
    return { dtes, prices, map };
  })() : null;

  const expiryLine = result ? result.grid.filter(g => g.dte === 0).sort((a, b) => a.price - b.price) : [];

  return (
    <AppShell>
      <ErrorBoundary label="Simulator">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <FlaskConical size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>P&amp;L Simulator</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Options strategy builder with Black-Scholes pricing &amp; Greeks</p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
          {/* Left: Position Builder */}
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Templates</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {TEMPLATES.map(t => (
                  <button key={t.name} onClick={() => applyTemplate(t)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', color: '#8888a8',
                  }}>{t.name}</button>
                ))}
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600 }}>Position Legs</span>
                <button onClick={addLeg} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
                  background: 'rgba(138,92,246,0.1)', border: '1px solid rgba(138,92,246,0.3)',
                  color: '#8a5cf6', fontSize: 11, cursor: 'pointer',
                }}><Plus size={12} /> Add Leg</button>
              </div>

              {legs.map((leg, i) => (
                <div key={leg.id} style={{
                  background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)',
                  padding: 12, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#555570', fontSize: 10, fontWeight: 600 }}>LEG {i + 1}</span>
                    {legs.length > 1 && (
                      <button onClick={() => removeLeg(leg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <Trash2 size={13} color="#f87171" />
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input value={leg.symbol} onChange={e => updateLeg(leg.id, 'symbol', e.target.value.toUpperCase())} placeholder="Symbol" style={inputStyle} />
                    <input type="number" value={leg.strike} onChange={e => updateLeg(leg.id, 'strike', +e.target.value)} placeholder="Strike" style={inputStyle} />
                    <select value={leg.type} onChange={e => updateLeg(leg.id, 'type', e.target.value)} style={inputStyle}>
                      <option value="call">Call</option><option value="put">Put</option>
                    </select>
                    <select value={leg.side} onChange={e => updateLeg(leg.id, 'side', e.target.value)} style={inputStyle}>
                      <option value="long">Long</option><option value="short">Short</option>
                    </select>
                    <input type="date" value={leg.expiration} onChange={e => updateLeg(leg.id, 'expiration', e.target.value)} style={inputStyle} />
                    <input type="number" value={leg.quantity} onChange={e => updateLeg(leg.id, 'quantity', +e.target.value)} min={1} placeholder="Qty" style={inputStyle} />
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#8888a8', fontSize: 11 }}>IV Change</span>
                  <span style={{ color: '#22d3ee', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{(ivChange * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={-0.5} max={0.5} step={0.05} value={ivChange}
                  onChange={e => setIvChange(+e.target.value)} style={{ width: '100%', accentColor: '#8a5cf6' }} />
              </div>

              <button onClick={runSimulation} disabled={loading} style={{
                width: '100%', padding: '12px', marginTop: 14, borderRadius: 10,
                background: loading ? '#333' : '#8a5cf6', border: 'none',
                color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}><Play size={16} /> {loading ? 'Simulating...' : 'Run Simulation'}</button>
            </div>
          </div>

          {/* Right: Results */}
          <div>
            {!result ? (
              <div style={{
                background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35',
                padding: 60, textAlign: 'center', color: '#555570', fontSize: 14, height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>Build your position and click &ldquo;Run Simulation&rdquo; to see P&amp;L analysis</div>
            ) : (
              <>
                {/* Stats Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: 'rgba(74,222,128,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Max Profit</div>
                    <div style={{ color: '#4ade80', fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {result.maxProfit === Infinity ? 'Unlimited' : `$${result.maxProfit.toFixed(0)}`}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(248,113,113,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Max Loss</div>
                    <div style={{ color: '#f87171', fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {result.maxLoss === -Infinity ? 'Unlimited' : `$${result.maxLoss.toFixed(0)}`}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(34,211,238,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Breakevens</div>
                    <div style={{ color: '#22d3ee', fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {result.breakevens.map(b => `$${b.toFixed(0)}`).join(', ') || 'N/A'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(138,92,246,0.08)', borderRadius: 10, padding: 14 }}>
                    <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Prob of Profit</div>
                    <div style={{ color: '#8a5cf6', fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {(result.probabilityOfProfit * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* View Toggle */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                  {(['heatmap', 'expiry'] as const).map(v => (
                    <button key={v} onClick={() => setViewMode(v)} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      background: viewMode === v ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${viewMode === v ? '#8a5cf6' : '#1e1e35'}`,
                      color: viewMode === v ? '#8a5cf6' : '#8888a8',
                    }}>{v === 'heatmap' ? 'Heatmap' : 'At Expiry'}</button>
                  ))}
                </div>

                {/* Heatmap */}
                {viewMode === 'heatmap' && heatmapData && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 16, overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '6px 8px', fontSize: 10, color: '#555570', textAlign: 'left' }}>DTE \ Price</th>
                          {heatmapData.prices.map(p => (
                            <th key={p} style={{ padding: '6px 4px', fontSize: 10, color: '#8888a8', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>${p.toFixed(0)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatmapData.dtes.map(dte => (
                          <tr key={dte}>
                            <td style={{ padding: '6px 8px', fontSize: 11, color: '#8888a8', fontFamily: "'JetBrains Mono', monospace" }}>{dte}d</td>
                            {heatmapData.prices.map(price => {
                              const pt = heatmapData.map.get(`${price}-${dte}`);
                              const pnl = pt?.pnl ?? 0;
                              return (
                                <td key={price} title={`P&L: $${pnl.toFixed(0)} | D${pt?.delta?.toFixed(2) ?? 0} T${pt?.theta?.toFixed(2) ?? 0}`} style={{
                                  padding: '6px 4px', textAlign: 'center', fontSize: 10,
                                  fontFamily: "'JetBrains Mono', monospace",
                                  background: getPnlColor(pnl, result.maxProfit, result.maxLoss),
                                  color: pnl >= 0 ? '#4ade80' : '#f87171', borderRadius: 2,
                                }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Expiry Line */}
                {viewMode === 'expiry' && expiryLine.length > 0 && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 16 }}>
                    <div style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>P&amp;L at Expiration</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 200 }}>
                      {expiryLine.map((pt, i) => {
                        const maxAbs = Math.max(Math.abs(result.maxProfit), Math.abs(result.maxLoss)) || 1;
                        const h = Math.abs(pt.pnl) / maxAbs * 100;
                        return (
                          <div key={i} title={`$${pt.price.toFixed(0)}: ${pt.pnl >= 0 ? '+' : ''}$${pt.pnl.toFixed(0)}`}
                            style={{
                              flex: 1, minWidth: 4, height: `${Math.max(h, 2)}%`,
                              background: pt.pnl >= 0 ? '#4ade80' : '#f87171',
                              borderRadius: '2px 2px 0 0', opacity: 0.8,
                              alignSelf: pt.pnl >= 0 ? 'flex-end' : 'flex-start',
                              marginTop: pt.pnl < 0 ? 'auto' : undefined,
                            }} />
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                      <span style={{ color: '#555570', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>${expiryLine[0]?.price.toFixed(0)}</span>
                      <span style={{ color: '#555570', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>${expiryLine[expiryLine.length - 1]?.price.toFixed(0)}</span>
                    </div>
                  </div>
                )}

                {/* Greeks Summary */}
                {result.grid.length > 0 && (() => {
                  const maxDte = Math.max(...result.grid.map(x => x.dte));
                  const current = result.grid.find(g => g.dte === maxDte) || result.grid[0];
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
                      {[
                        { label: 'Net Delta', value: current.delta, color: '#4ade80' },
                        { label: 'Net Gamma', value: current.gamma, color: '#22d3ee' },
                        { label: 'Net Theta', value: current.theta, color: '#f0c674' },
                        { label: 'P&L', value: current.pnl, color: current.pnl >= 0 ? '#4ade80' : '#f87171' },
                      ].map(g => (
                        <div key={g.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                          <div style={{ color: '#555570', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>{g.label}</div>
                          <div style={{ color: g.color, fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{g.value?.toFixed(3) ?? 'N/A'}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
