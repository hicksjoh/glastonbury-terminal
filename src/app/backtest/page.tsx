'use client';

import { useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Play, RotateCw, BarChart3, AlertTriangle } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface Trade {
  date: string;
  action: 'BUY' | 'SELL';
  price: number;
  pnl: number;
  shares: number;
}

interface EquityPoint {
  date: string;
  value: number;
}

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
  tradeLog: Trade[];
  equityCurve: EquityPoint[];
  message?: string;
}

interface ApiError {
  error: string;
}

// ── Constants ──────────────────────────────────────────────────────

const STRATEGIES = [
  { id: 'wheel', label: 'Covered Call Wheel', desc: 'Sell puts, own stock, sell calls' },
  { id: 'dip_buy', label: 'Dip Buy', desc: 'Buy on pullbacks from moving avg' },
  { id: 'earnings_straddle', label: 'Earnings Straddle', desc: 'Buy straddle before earnings' },
  { id: 'momentum', label: 'Momentum', desc: 'Buy top performers, rotate monthly' },
  { id: 'custom', label: 'Custom Strategy', desc: 'Define your own rules' },
];

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid #1e1e35',
  borderRadius: 14,
  padding: 20,
};

const LABEL_STYLE: React.CSSProperties = {
  color: '#8a5cf6',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
  marginBottom: 14,
  fontFamily: "'JetBrains Mono', monospace",
};

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

// ── Component ──────────────────────────────────────────────────────

export default function BacktestPage() {
  const [strategy, setStrategy] = useState('wheel');
  const [ticker, setTicker] = useState('SPY');
  const [period, setPeriod] = useState('1y');
  const [positionSize, setPositionSize] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: ticker,
          strategy,
          period,
          positionSize,
        }),
      });

      const data: BacktestResult | ApiError = await res.json();

      if (!res.ok || 'error' in data) {
        setError((data as ApiError).error);
      } else {
        setResult(data as BacktestResult);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
    } finally {
      setRunning(false);
    }
  }, [ticker, strategy, period, positionSize]);

  return (
    <AppShell>
      <ErrorBoundary label="Backtest">
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Strategy Backtester</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>Test strategies against real FMP historical data</p>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24 }}>
          {/* ── Sidebar Controls ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={CARD_STYLE}>
              <div style={LABEL_STYLE}>Strategy</div>
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

            <div style={CARD_STYLE}>
              <div style={LABEL_STYLE}>Parameters</div>

              <label style={{ color: '#8888a8', fontSize: 11, display: 'block', marginBottom: 4 }}>Ticker Symbol</label>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
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

          {/* ── Results Area ── */}
          <div>
            {/* Error Banner */}
            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.08)', border: '1px solid #f87171',
                borderRadius: 12, padding: '14px 18px', marginBottom: 16,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <AlertTriangle size={16} color="#f87171" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ color: '#f87171', fontSize: 13, lineHeight: 1.5 }}>{error}</div>
              </div>
            )}

            {/* Empty State */}
            {!result && !error && !running && (
              <div style={{
                ...CARD_STYLE,
                padding: 80, textAlign: 'center',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <BarChart3 size={48} color="#1e1e35" style={{ marginBottom: 16 }} />
                <div style={{ color: '#555570', fontSize: 14 }}>Select a strategy and parameters, then hit Run Backtest</div>
              </div>
            )}

            {/* Loading State */}
            {running && (
              <div style={{
                ...CARD_STYLE,
                padding: 80, textAlign: 'center',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <RotateCw size={32} color="#8a5cf6" className="animate-spin" style={{ marginBottom: 16 }} />
                <div style={{ color: '#8888a8', fontSize: 14 }}>Fetching data and running backtest for {ticker}...</div>
              </div>
            )}

            {/* Results */}
            {result && (
              <>
                {/* Strategy message */}
                {result.message && (
                  <div style={{
                    background: 'rgba(138,92,246,0.08)', border: '1px solid rgba(138,92,246,0.3)',
                    borderRadius: 10, padding: '10px 14px', marginBottom: 14,
                    color: '#a78bfa', fontSize: 12,
                  }}>
                    {result.message}
                  </div>
                )}

                {/* Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
                  {[
                    { label: 'Total Return', value: `${result.totalReturn.toFixed(1)}%`, color: result.totalReturn >= 0 ? '#4ade80' : '#f87171' },
                    { label: 'CAGR', value: `${result.cagr.toFixed(1)}%`, color: '#8a5cf6' },
                    { label: 'Sharpe Ratio', value: result.sharpe.toFixed(3), color: result.sharpe >= 1 ? '#4ade80' : '#f0c674' },
                    { label: 'Sortino Ratio', value: result.sortino.toFixed(3), color: '#22d3ee' },
                    { label: 'Max Drawdown', value: `${result.maxDrawdown.toFixed(1)}%`, color: '#f87171' },
                    { label: 'Win Rate', value: `${result.winRate.toFixed(1)}%`, color: result.winRate >= 50 ? '#4ade80' : '#f87171' },
                    { label: 'Avg Win', value: result.avgWin >= 0 ? `+$${result.avgWin.toFixed(0)}` : `$${result.avgWin.toFixed(0)}`, color: '#4ade80' },
                    { label: 'Avg Loss', value: `$${result.avgLoss.toFixed(0)}`, color: '#f87171' },
                    { label: 'Profit Factor', value: result.profitFactor >= 100 ? '99+' : result.profitFactor.toFixed(2), color: result.profitFactor >= 1.5 ? '#4ade80' : '#f0c674' },
                  ].map(r => (
                    <div key={r.label} style={{
                      ...CARD_STYLE,
                      padding: 14,
                      borderRadius: 12,
                    }}>
                      <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, ...MONO }}>
                        {r.label}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: r.color, ...MONO }}>
                        {r.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Equity Curve */}
                <EquityCurveChart curve={result.equityCurve} positive={result.totalReturn >= 0} />

                {/* Trade Log Table */}
                {result.tradeLog.length > 0 && (
                  <TradeLogTable trades={result.tradeLog} />
                )}

                <div style={{ color: '#555570', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
                  {result.trades} closed trade{result.trades !== 1 ? 's' : ''} over {period} period
                  {' '}&bull;{' '}Strategy: {STRATEGIES.find(s => s.id === strategy)?.label}
                  {' '}&bull;{' '}Symbol: {ticker}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}

// ── Equity Curve Chart ─────────────────────────────────────────────

function EquityCurveChart({ curve, positive }: { curve: EquityPoint[]; positive: boolean }) {
  if (curve.length === 0) return null;

  const values = curve.map(p => p.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const chartHeight = 180;
  const chartWidth = 700;

  // Build SVG path
  const points = curve.map((p, i) => {
    const x = (i / (curve.length - 1)) * chartWidth;
    const y = chartHeight - ((p.value - minVal) / range) * (chartHeight - 20);
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`;

  const lineColor = positive ? '#4ade80' : '#f87171';
  const fillColor = positive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)';

  // Tick labels (first, middle, last date)
  const firstDate = curve[0]?.date ?? '';
  const midDate = curve[Math.floor(curve.length / 2)]?.date ?? '';
  const lastDate = curve[curve.length - 1]?.date ?? '';

  return (
    <div style={{ ...CARD_STYLE, padding: 24, marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ ...LABEL_STYLE }}>Equity Curve</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: '#555570', fontSize: 10, ...MONO }}>${minVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        <span style={{ color: '#555570', fontSize: 10, ...MONO }}>${maxVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: chartHeight }}>
        <path d={areaPath} fill={fillColor} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ color: '#555570', fontSize: 10, ...MONO }}>{firstDate}</span>
        <span style={{ color: '#555570', fontSize: 10, ...MONO }}>{midDate}</span>
        <span style={{ color: '#555570', fontSize: 10, ...MONO }}>{lastDate}</span>
      </div>
    </div>
  );
}

// ── Trade Log Table ────────────────────────────────────────────────

function TradeLogTable({ trades }: { trades: Trade[] }) {
  return (
    <div style={{ ...CARD_STYLE, padding: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ ...LABEL_STYLE, padding: '16px 20px 0', marginBottom: 0 }}>Trade Log</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO, fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1e35' }}>
              {['Date', 'Action', 'Price', 'Shares', 'P&L'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left',
                  color: '#555570', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 600,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={`${t.date}-${t.action}-${i}`} style={{ borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                <td style={{ padding: '8px 16px', color: '#8888a8' }}>{t.date}</td>
                <td style={{
                  padding: '8px 16px',
                  color: t.action === 'BUY' ? '#4ade80' : '#f87171',
                  fontWeight: 700,
                }}>
                  {t.action}
                </td>
                <td style={{ padding: '8px 16px', color: '#e8e8f0' }}>${t.price.toFixed(2)}</td>
                <td style={{ padding: '8px 16px', color: '#8888a8' }}>{t.shares}</td>
                <td style={{
                  padding: '8px 16px',
                  color: t.pnl > 0 ? '#4ade80' : t.pnl < 0 ? '#f87171' : '#555570',
                  fontWeight: 600,
                }}>
                  {t.action === 'BUY' ? '—' : `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
