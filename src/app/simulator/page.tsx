'use client';

import { useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { FlaskConical, Plus, Trash2, Play } from 'lucide-react';

interface Leg {
  id: string;
  symbol: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  side: 'long' | 'short';
  quantity: number;
  premium: number;
  iv: number;
}

interface SimResult {
  grid: { price: number; dte: number; pnl: number; delta: number; theta: number; gamma: number }[];
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  probabilityOfProfit: number;
}

const TEMPLATES: Record<string, Partial<Leg>[]> = {
  'Long Call': [{ type: 'call', side: 'long', quantity: 1 }],
  'Long Put': [{ type: 'put', side: 'long', quantity: 1 }],
  'Covered Call': [{ type: 'call', side: 'short', quantity: 1 }],
  'Straddle': [{ type: 'call', side: 'long', quantity: 1 }, { type: 'put', side: 'long', quantity: 1 }],
  'Iron Condor': [
    { type: 'put', side: 'long', quantity: 1 },
    { type: 'put', side: 'short', quantity: 1 },
    { type: 'call', side: 'short', quantity: 1 },
    { type: 'call', side: 'long', quantity: 1 },
  ],
  'Bull Call Spread': [{ type: 'call', side: 'long', quantity: 1 }, { type: 'call', side: 'short', quantity: 1 }],
  'Butterfly': [
    { type: 'call', side: 'long', quantity: 1 },
    { type: 'call', side: 'short', quantity: 2 },
    { type: 'call', side: 'long', quantity: 1 },
  ],
};

const newLeg = (): Leg => ({
  id: Date.now().toString() + Math.random(),
  symbol: 'AAPL',
  strike: 200,
  expiration: getDefaultExpiry(),
  type: 'call',
  side: 'long',
  quantity: 1,
  premium: 5,
  iv: 0.30,
});

function getDefaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

export default function SimulatorPage() {
  const [legs, setLegs] = useState<Leg[]>([newLeg()]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ivChange, setIvChange] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<{ price: number; dte: number; pnl: number } | null>(null);

  const addLeg = () => setLegs(prev => [...prev, newLeg()]);

  const removeLeg = (id: string) => setLegs(prev => prev.filter(l => l.id !== id));

  const updateLeg = (id: string, field: keyof Leg, value: unknown) => {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const applyTemplate = (name: string) => {
    const template = TEMPLATES[name];
    if (!template) return;
    const baseStrike = legs[0]?.strike || 200;
    const sym = legs[0]?.symbol || 'AAPL';
    const exp = legs[0]?.expiration || getDefaultExpiry();

    const newLegs = template.map((t, i) => ({
      ...newLeg(),
      symbol: sym,
      strike: name === 'Iron Condor'
        ? baseStrike + [-10, -5, 5, 10][i]
        : name === 'Butterfly'
          ? baseStrike + [-5, 0, 5][i]
          : name === 'Bull Call Spread'
            ? baseStrike + [0, 10][i]
            : baseStrike,
      expiration: exp,
      ...t,
    } as Leg));

    setLegs(newLegs);
  };

  const runSimulation = useCallback(async () => {
    if (legs.length === 0) return;
    setLoading(true);
    try {
      const avgStrike = legs.reduce((s, l) => s + l.strike, 0) / legs.length;
      const currentDte = Math.max(1, Math.round((new Date(legs[0].expiration).getTime() - Date.now()) / 86400000));

      const res = await fetch('/api/options-sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legs: legs.map(l => ({
            symbol: l.symbol,
            strike: l.strike,
            expiration: l.expiration,
            type: l.type,
            side: l.side,
            quantity: l.quantity,
            premium: l.premium,
            iv: l.iv,
          })),
          priceRange: { min: avgStrike * 0.8, max: avgStrike * 1.2, step: avgStrike * 0.01 },
          dteRange: { current: currentDte, simDays: currentDte },
          ivChange,
        }),
      });

      if (res.ok) setResult(await res.json());
    } catch (err) {
      console.error('Sim error:', err);
    } finally {
      setLoading(false);
    }
  }, [legs, ivChange]);

  // Heatmap data: group by DTE
  const heatmapByDte = result ? groupByDte(result.grid) : {};
  const dteKeys = Object.keys(heatmapByDte).map(Number).sort((a, b) => b - a);
  const priceKeys = result ? [...new Set(result.grid.filter(g => g.dte === dteKeys[0]).map(g => g.price))].sort((a, b) => a - b) : [];

  // Net Greeks (from current DTE)
  const currentGreeks = result?.grid
    .filter(g => g.dte === Math.max(...dteKeys))
    .reduce((acc, g) => {
      if (Math.abs(g.price - (legs.reduce((s, l) => s + l.strike, 0) / legs.length)) < (priceKeys[1] - priceKeys[0]) * 0.5) {
        return { delta: g.delta, theta: g.theta, gamma: g.gamma };
      }
      return acc;
    }, { delta: 0, theta: 0, gamma: 0 });

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <FlaskConical size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>P&amp;L Simulator</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Options strategy builder &bull; interactive P&amp;L heatmap &bull; Greeks analysis</p>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
          {/* Left Panel: Position Builder */}
          <div>
            {/* Templates */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>Templates</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Object.keys(TEMPLATES).map(t => (
                  <button key={t} onClick={() => applyTemplate(t)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                    border: '1px solid #1e1e35', background: 'rgba(255,255,255,0.03)', color: '#888',
                  }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Legs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {legs.map((leg, idx) => (
                <div key={leg.id} style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                  borderRadius: 10, padding: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#888', fontSize: 10, fontWeight: 600 }}>LEG {idx + 1}</span>
                    {legs.length > 1 && (
                      <button onClick={() => removeLeg(leg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                        <Trash2 size={12} color="#f87171" />
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <LegInput label="Symbol" value={leg.symbol} onChange={v => updateLeg(leg.id, 'symbol', v)} />
                    <LegInput label="Strike" value={leg.strike} type="number" onChange={v => updateLeg(leg.id, 'strike', Number(v))} />
                    <LegInput label="Expiry" value={leg.expiration} type="date" onChange={v => updateLeg(leg.id, 'expiration', v)} />
                    <LegInput label="Premium" value={leg.premium} type="number" onChange={v => updateLeg(leg.id, 'premium', Number(v))} />

                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['call', 'put'] as const).map(t => (
                        <button key={t} onClick={() => updateLeg(leg.id, 'type', t)} style={{
                          flex: 1, padding: '4px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                          textTransform: 'uppercase', fontWeight: 600,
                          border: `1px solid ${leg.type === t ? (t === 'call' ? '#4ade80' : '#f87171') : '#1e1e35'}`,
                          background: leg.type === t ? (t === 'call' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)') : 'transparent',
                          color: leg.type === t ? (t === 'call' ? '#4ade80' : '#f87171') : '#666',
                        }}>{t}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['long', 'short'] as const).map(s => (
                        <button key={s} onClick={() => updateLeg(leg.id, 'side', s)} style={{
                          flex: 1, padding: '4px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                          textTransform: 'uppercase', fontWeight: 600,
                          border: `1px solid ${leg.side === s ? '#8a5cf6' : '#1e1e35'}`,
                          background: leg.side === s ? 'rgba(138,92,246,0.1)' : 'transparent',
                          color: leg.side === s ? '#8a5cf6' : '#666',
                        }}>{s}</button>
                      ))}
                    </div>

                    <LegInput label="Qty" value={leg.quantity} type="number" onChange={v => updateLeg(leg.id, 'quantity', Number(v))} />
                    <LegInput label="IV" value={(leg.iv * 100).toFixed(0)} type="number" onChange={v => updateLeg(leg.id, 'iv', Number(v) / 100)} />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addLeg} style={{
              width: '100%', padding: '8px', borderRadius: 8, cursor: 'pointer',
              border: '1px dashed #2a2a3a', background: 'transparent', color: '#666',
              fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginBottom: 12,
            }}>
              <Plus size={14} /> Add Leg
            </button>

            {/* IV Change Slider */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase' }}>IV Change</span>
                <span style={{ fontSize: 11, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>{ivChange > 0 ? '+' : ''}{(ivChange * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min="-50" max="50" value={ivChange * 100}
                onChange={e => setIvChange(Number(e.target.value) / 100)}
                style={{ width: '100%' }}
              />
            </div>

            <button onClick={runSimulation} disabled={loading} style={{
              width: '100%', padding: '12px', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
              background: '#8a5cf6', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: loading ? 0.6 : 1,
            }}>
              <Play size={14} /> {loading ? 'Simulating...' : 'Run Simulation'}
            </button>
          </div>

          {/* Right Panel: Results */}
          <div>
            {!result ? (
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                borderRadius: 12, padding: 60, textAlign: 'center',
              }}>
                <FlaskConical size={40} color="#333" style={{ marginBottom: 12 }} />
                <p style={{ color: '#555', fontSize: 13, margin: 0 }}>Build your position and click Run Simulation</p>
              </div>
            ) : (
              <>
                {/* Stats Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                  <SimStat label="Max Profit" value={`$${result.maxProfit.toLocaleString()}`} color={result.maxProfit >= 0 ? '#4ade80' : '#f87171'} />
                  <SimStat label="Max Loss" value={`$${result.maxLoss.toLocaleString()}`} color="#f87171" />
                  <SimStat label="Breakevens" value={result.breakevens.map(b => `$${b}`).join(', ') || 'None'} color="#22d3ee" />
                  <SimStat label="P(Profit)" value={`${result.probabilityOfProfit}%`} color={result.probabilityOfProfit >= 50 ? '#4ade80' : '#f87171'} />
                </div>

                {/* Greeks */}
                {currentGreeks && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                    <SimStat label="Net Delta" value={currentGreeks.delta.toFixed(3)} color="#8a5cf6" />
                    <SimStat label="Net Theta" value={`$${currentGreeks.theta.toFixed(2)}/day`} color="#f0c674" />
                    <SimStat label="Net Gamma" value={currentGreeks.gamma.toFixed(4)} color="#22d3ee" />
                  </div>
                )}

                {/* P&L Heatmap */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                  borderRadius: 12, padding: 16, overflow: 'auto',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>P&amp;L Heatmap</h3>
                    {hoveredCell && (
                      <span style={{ fontSize: 11, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                        ${hoveredCell.price} / {hoveredCell.dte}DTE = <span style={{ color: hoveredCell.pnl >= 0 ? '#4ade80' : '#f87171' }}>${hoveredCell.pnl}</span>
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${Math.min(priceKeys.length, 20)}, 1fr)`, gap: 1 }}>
                    {/* Header row */}
                    <div style={{ padding: 4 }} />
                    {priceKeys.filter((_, i) => i % Math.ceil(priceKeys.length / 20) === 0).map(p => (
                      <div key={p} style={{ padding: '2px 0', fontSize: 8, color: '#555', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
                        ${p.toFixed(0)}
                      </div>
                    ))}

                    {/* DTE rows */}
                    {dteKeys.map(dte => (
                      <>
                        <div key={`label-${dte}`} style={{ padding: '4px 6px', fontSize: 9, color: '#888', fontFamily: "'JetBrains Mono', monospace" }}>
                          {dte}d
                        </div>
                        {priceKeys.filter((_, i) => i % Math.ceil(priceKeys.length / 20) === 0).map(price => {
                          const cell = heatmapByDte[dte]?.find(g => g.price === price);
                          const pnl = cell?.pnl || 0;
                          return (
                            <div
                              key={`${dte}-${price}`}
                              onMouseEnter={() => setHoveredCell({ price, dte, pnl })}
                              onMouseLeave={() => setHoveredCell(null)}
                              style={{
                                padding: 2, borderRadius: 2, minHeight: 20,
                                background: getPnlColor(pnl, result.maxProfit, result.maxLoss),
                                cursor: 'pointer',
                              }}
                            />
                          );
                        })}
                      </>
                    ))}
                  </div>
                </div>

                {/* Expiration P&L Line */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                  borderRadius: 12, padding: 16, marginTop: 12,
                }}>
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>P&amp;L at Expiration</h3>
                  <div style={{ display: 'flex', alignItems: 'end', gap: 1, height: 120 }}>
                    {result.grid.filter(g => g.dte === 0).map((g, i) => {
                      const maxAbs = Math.max(Math.abs(result.maxProfit), Math.abs(result.maxLoss)) || 1;
                      const height = Math.abs(g.pnl) / maxAbs * 100;
                      return (
                        <div key={i} style={{
                          flex: 1, minWidth: 2, borderRadius: '2px 2px 0 0',
                          height: `${Math.max(2, height)}%`,
                          background: g.pnl >= 0 ? '#4ade80' : '#f87171',
                          opacity: 0.7,
                          alignSelf: g.pnl >= 0 ? 'flex-end' : 'flex-end',
                          marginTop: g.pnl < 0 ? 'auto' : undefined,
                        }} />
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function LegInput({ label, value, type = 'text', onChange }: { label: string; value: string | number; type?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#555', marginBottom: 2, textTransform: 'uppercase' }}>{label}</div>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '5px 8px', borderRadius: 4,
          border: '1px solid #1e1e35', background: '#0a0a1a', color: '#e8e8e8',
          fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
        }}
      />
    </div>
  );
}

function SimStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: `${color}08`, border: `1px solid ${color}15`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 10, color: '#555', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function groupByDte(grid: { price: number; dte: number; pnl: number }[]): Record<number, typeof grid> {
  const map: Record<number, typeof grid> = {};
  for (const g of grid) {
    if (!map[g.dte]) map[g.dte] = [];
    map[g.dte].push(g);
  }
  return map;
}

function getPnlColor(pnl: number, maxProfit: number, maxLoss: number): string {
  if (pnl >= 0) {
    const intensity = maxProfit > 0 ? Math.min(pnl / maxProfit, 1) : 0;
    return `rgba(74, 222, 128, ${0.05 + intensity * 0.5})`;
  }
  const intensity = maxLoss < 0 ? Math.min(Math.abs(pnl) / Math.abs(maxLoss), 1) : 0;
  return `rgba(248, 113, 113, ${0.05 + intensity * 0.5})`;
}
