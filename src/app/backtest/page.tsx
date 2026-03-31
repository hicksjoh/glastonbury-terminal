'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Play, RotateCw, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface BacktestResult {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: number;
}

const STRATEGIES = [
  { id: 'wheel', label: 'Covered Call Wheel', desc: 'Sell puts, own stock, sell calls' },
  { id: 'dip_buy', label: 'Dip Buy', desc: 'Buy on pullbacks from moving avg' },
  { id: 'earnings_straddle', label: 'Earnings Straddle', desc: 'Buy straddle before earnings' },
  { id: 'momentum', label: 'Momentum', desc: 'Buy top performers, rotate monthly' },
  { id: 'custom', label: 'Custom Strategy', desc: 'Define your own rules' },
];

export default function BacktestPage() {
  const [strategy, setStrategy] = useState('wheel');
  const [ticker, setTicker] = useState('SPY');
  const [period, setPeriod] = useState('1y');
  const [positionSize, setPositionSize] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const runBacktest = () => {
    setRunning(true);
    // Simulated backtest results
    setTimeout(() => {
      setResult({
        totalReturn: 24.5 + Math.random() * 10,
        cagr: 18.2 + Math.random() * 5,
        sharpe: 1.2 + Math.random() * 0.5,
        sortino: 1.6 + Math.random() * 0.5,
        maxDrawdown: -(8 + Math.random() * 10),
        winRate: 58 + Math.random() * 15,
        avgWin: 3.2 + Math.random() * 2,
        avgLoss: -(1.5 + Math.random()),
        profitFactor: 1.8 + Math.random() * 0.5,
        trades: 24 + Math.floor(Math.random() * 30),
      });
      setRunning(false);
    }, 1500);
  };

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Strategy Backtester</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>Test strategies against historical data</p>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24 }}>
          {/* Sidebar Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 20 }}>
              <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                Strategy
              </div>
              {STRATEGIES.map(s => (
                <div
                  key={s.id}
                  onClick={() => setStrategy(s.id)}
                  style={{
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                    background: strategy === s.id ? 'rgba(138,92,246,0.1)' : 'transparent',
                    border: `1px solid ${strategy === s.id ? '#8a5cf6' : 'transparent'}`,
                  }}
                >
                  <div style={{ color: strategy === s.id ? '#8a5cf6' : '#e8e8f0', fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ color: '#555570', fontSize: 11 }}>{s.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 20 }}>
              <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                Parameters
              </div>

              <label style={{ color: '#8888a8', fontSize: 11, display: 'block', marginBottom: 4 }}>Ticker Universe</label>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  background: '#0a0a1a', border: '1px solid #1e1e35', color: '#e8e8f0',
                  fontSize: 13, marginBottom: 12, outline: 'none',
                }}
              />

              <label style={{ color: '#8888a8', fontSize: 11, display: 'block', marginBottom: 4 }}>Time Period</label>
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {['6m', '1y', '2y', '5y'].map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      flex: 1, padding: '6px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                      background: period === p ? '#8a5cf6' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${period === p ? '#8a5cf6' : '#1e1e35'}`,
                      color: period === p ? '#fff' : '#8888a8',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <label style={{ color: '#8888a8', fontSize: 11, display: 'block', marginBottom: 4 }}>Position Size: {positionSize}%</label>
              <input
                type="range"
                min="1" max="100" value={positionSize}
                onChange={e => setPositionSize(Number(e.target.value))}
                style={{ width: '100%', marginBottom: 16 }}
              />

              <button
                onClick={runBacktest}
                disabled={running}
                style={{
                  width: '100%', padding: '12px', borderRadius: 10, cursor: running ? 'not-allowed' : 'pointer',
                  background: '#8a5cf6', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: running ? 0.6 : 1,
                }}
              >
                {running ? <><RotateCw size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run Backtest</>}
              </button>
            </div>
          </div>

          {/* Results Area */}
          <div>
            {!result ? (
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 14,
                padding: 80, textAlign: 'center',
              }}>
                <BarChart3 size={48} color="#1e1e35" style={{ marginBottom: 16 }} />
                <div style={{ color: '#555570', fontSize: 14 }}>Select a strategy and parameters, then hit Run Backtest</div>
              </div>
            ) : (
              <>
                {/* Results Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                  {[
                    { label: 'Total Return', value: `${result.totalReturn.toFixed(1)}%`, color: result.totalReturn >= 0 ? '#4ade80' : '#f87171' },
                    { label: 'CAGR', value: `${result.cagr.toFixed(1)}%`, color: '#8a5cf6' },
                    { label: 'Sharpe Ratio', value: result.sharpe.toFixed(3), color: result.sharpe >= 1 ? '#4ade80' : '#f0c674' },
                    { label: 'Sortino Ratio', value: result.sortino.toFixed(3), color: '#22d3ee' },
                    { label: 'Max Drawdown', value: `${result.maxDrawdown.toFixed(1)}%`, color: '#f87171' },
                    { label: 'Win Rate', value: `${result.winRate.toFixed(1)}%`, color: result.winRate >= 50 ? '#4ade80' : '#f87171' },
                    { label: 'Avg Win', value: `+${result.avgWin.toFixed(1)}%`, color: '#4ade80' },
                    { label: 'Avg Loss', value: `${result.avgLoss.toFixed(1)}%`, color: '#f87171' },
                    { label: 'Profit Factor', value: result.profitFactor.toFixed(2), color: result.profitFactor >= 1.5 ? '#4ade80' : '#f0c674' },
                  ].map(r => (
                    <div key={r.label} style={{
                      background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
                      borderRadius: 12, padding: 14,
                    }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                        {r.label}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: r.color, fontFamily: "'JetBrains Mono', monospace" }}>
                        {r.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Equity Curve Placeholder */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                  borderRadius: 14, padding: 24, marginBottom: 16,
                }}>
                  <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                    Equity Curve
                  </div>
                  {/* Simplified sparkline equity curve */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: 150, gap: 2 }}>
                    {Array.from({ length: 60 }, (_, i) => {
                      const growth = Math.pow(1 + result.totalReturn / 100, i / 60);
                      const noise = 1 + (Math.sin(i * 0.5) * 0.03 + Math.sin(i * 1.3) * 0.02);
                      const h = growth * noise * 100;
                      return (
                        <div key={i} style={{
                          flex: 1, height: h, background: result.totalReturn >= 0 ? '#4ade8040' : '#f8717140',
                          borderRadius: '2px 2px 0 0',
                        }} />
                      );
                    })}
                  </div>
                </div>

                <div style={{ color: '#555570', fontSize: 12, textAlign: 'center' }}>
                  {result.trades} total trades over {period} period • Strategy: {STRATEGIES.find(s => s.id === strategy)?.label}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
