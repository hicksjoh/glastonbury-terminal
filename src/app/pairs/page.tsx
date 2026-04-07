'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GitCompare, Search, Loader2, ChevronDown, ChevronUp, Activity, TrendingUp, TrendingDown, Target } from 'lucide-react';

/* ── types ─────────────────────────────────────────────────────── */

interface PairScanResult {
  symbolA: string;
  symbolB: string;
  correlation: number;
  cointegrationPValue: number;
  halfLife: number;
  zScore: number;
  signal: { action: string };
  hedgeRatio: number;
  backtest: { winRate: number; sharpe: number; trades: number };
}

interface SpreadPoint {
  date: string;
  spread: number;
  zScore: number;
}

interface PairDetail {
  symbolA: string;
  symbolB: string;
  hedgeRatio: number;
  halfLife: number;
  spread: { current: number; mean: number; zScore: number; history: SpreadPoint[] };
  signal: { action: string; entry?: number; exit?: number; stop?: number };
  backtest: { trades: number; winRate: number; sharpe: number; maxDrawdown: number; pnl: number; equityCurve: number[] };
  cointegration: { pValue: number; testStat: number; criticalValue: number };
}

/* ── palette ───────────────────────────────────────────────────── */

const C = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
  text: '#e8e8f0',
  muted: '#8888a8',
  dim: '#555570',
  mono: "'JetBrains Mono', monospace",
};

const DEFAULT_SYMBOLS = 'AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA';

/* ── helpers ───────────────────────────────────────────────────── */

function zScoreColor(z: number): string {
  const abs = Math.abs(z);
  if (abs >= 2.0) return C.red;
  if (abs >= 1.5) return C.gold;
  return C.green;
}

function signalColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('long') || a.includes('buy')) return C.green;
  if (a.includes('short') || a.includes('sell')) return C.red;
  if (a.includes('close') || a.includes('exit')) return C.gold;
  return C.cyan;
}

function signalBadge(action: string) {
  const color = signalColor(action);
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 6,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      background: color + '18', color, border: `1px solid ${color}40`,
      fontFamily: C.mono, textTransform: 'uppercase',
    }}>
      {action}
    </span>
  );
}

/* ── skeleton ──────────────────────────────────────────────────── */

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} style={{ padding: '14px 12px' }}>
          <div style={{
            height: 14, borderRadius: 4, background: 'rgba(255,255,255,0.04)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        </td>
      ))}
    </tr>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <style>{`@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`}</style>
      {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
    </>
  );
}

/* ── spread chart (CSS bars) ───────────────────────────────────── */

function SpreadChart({ history, mean }: { history: SpreadPoint[]; mean: number }) {
  if (!history.length) return null;
  const spreads = history.map(h => h.spread);
  const stdDev = Math.sqrt(spreads.reduce((s, v) => s + (v - mean) ** 2, 0) / spreads.length);
  const minVal = Math.min(...spreads, mean - 2.5 * stdDev);
  const maxVal = Math.max(...spreads, mean + 2.5 * stdDev);
  const range = maxVal - minVal || 1;
  const chartHeight = 180;

  const toY = (v: number) => chartHeight - ((v - minVal) / range) * chartHeight;
  const meanY = toY(mean);
  const upperY = toY(mean + 2 * stdDev);
  const lowerY = toY(mean - 2 * stdDev);
  const barWidth = Math.max(2, Math.floor(600 / history.length) - 1);

  return (
    <div style={{ position: 'relative', height: chartHeight, width: '100%', overflow: 'hidden', marginTop: 12 }}>
      {/* sigma bands */}
      <div style={{
        position: 'absolute', top: upperY, left: 0, right: 0, height: lowerY - upperY,
        background: `${C.purple}08`, borderTop: `1px dashed ${C.purple}30`, borderBottom: `1px dashed ${C.purple}30`,
      }} />
      {/* mean line */}
      <div style={{
        position: 'absolute', top: meanY, left: 0, right: 0, height: 1,
        background: C.gold, opacity: 0.6,
      }} />
      {/* labels */}
      <span style={{ position: 'absolute', top: meanY - 16, right: 4, fontSize: 9, color: C.gold, fontFamily: C.mono }}>mean</span>
      <span style={{ position: 'absolute', top: upperY - 14, right: 4, fontSize: 9, color: C.purple, fontFamily: C.mono, opacity: 0.6 }}>+2&sigma;</span>
      <span style={{ position: 'absolute', top: lowerY + 2, right: 4, fontSize: 9, color: C.purple, fontFamily: C.mono, opacity: 0.6 }}>-2&sigma;</span>
      {/* bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', height: chartHeight, gap: 1 }}>
        {history.map((pt, i) => {
          const barH = ((pt.spread - minVal) / range) * chartHeight;
          const isAbove = pt.spread > mean;
          return (
            <div key={i} title={`${pt.date}: ${pt.spread.toFixed(4)} (z=${pt.zScore.toFixed(2)})`} style={{
              width: barWidth, height: barH,
              background: isAbove ? (pt.spread > mean + 2 * stdDev ? C.red : C.purple) : (pt.spread < mean - 2 * stdDev ? C.green : C.cyan),
              opacity: 0.7, borderRadius: '2px 2px 0 0', flexShrink: 0,
            }} />
          );
        })}
      </div>
    </div>
  );
}

/* ── z-score bar ───────────────────────────────────────────────── */

function ZScoreBar({ zScore }: { zScore: number }) {
  const clamped = Math.max(-3, Math.min(3, zScore));
  const pct = ((clamped + 3) / 6) * 100;
  return (
    <div style={{ position: 'relative', height: 24, background: '#111122', borderRadius: 6, overflow: 'hidden' }}>
      {/* zero line */}
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: C.dim }} />
      {/* +-2 markers */}
      <div style={{ position: 'absolute', left: `${((2 + 3) / 6) * 100}%`, top: 0, bottom: 0, width: 1, background: C.red + '40' }} />
      <div style={{ position: 'absolute', left: `${((-2 + 3) / 6) * 100}%`, top: 0, bottom: 0, width: 1, background: C.green + '40' }} />
      {/* indicator */}
      <div style={{
        position: 'absolute', left: `${pct}%`, top: 2, width: 8, height: 20,
        borderRadius: 4, background: zScoreColor(zScore), transform: 'translateX(-50%)',
      }} />
    </div>
  );
}

/* ── stat card ─────────────────────────────────────────────────── */

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: C.mono, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: C.mono }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ── detail panel ──────────────────────────────────────────────── */

function DetailPanel({ detail }: { detail: PairDetail }) {
  const { spread, backtest, signal, cointegration, hedgeRatio, halfLife } = detail;

  return (
    <div style={{ padding: '20px 0 8px', borderTop: `1px solid ${C.border}` }}>
      {/* top stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard label="Hedge Ratio" value={hedgeRatio.toFixed(3)} color={C.cyan} />
        <StatCard label="Half-Life" value={`${halfLife.toFixed(1)}d`} color={C.purple} />
        <StatCard label="Spread Z" value={spread.zScore.toFixed(2)} color={zScoreColor(spread.zScore)} />
        <StatCard label="Coint. p-val" value={cointegration.pValue.toFixed(4)} color={cointegration.pValue < 0.05 ? C.green : C.red} />
      </div>

      {/* z-score visualization */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Z-Score Position</div>
        <ZScoreBar zScore={spread.zScore} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dim, fontFamily: C.mono, marginTop: 4 }}>
          <span>-3</span><span>-2</span><span>-1</span><span>0</span><span>+1</span><span>+2</span><span>+3</span>
        </div>
      </div>

      {/* spread chart */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Spread History
        </div>
        <SpreadChart history={spread.history} mean={spread.mean} />
      </div>

      {/* backtest stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard label="Trades" value={String(backtest.trades)} color={C.text} />
        <StatCard label="Win Rate" value={`${backtest.winRate.toFixed(1)}%`} color={backtest.winRate >= 50 ? C.green : C.red} />
        <StatCard label="Sharpe" value={backtest.sharpe.toFixed(2)} color={backtest.sharpe >= 1 ? C.green : C.gold} />
        <StatCard label="Max DD" value={`${backtest.maxDrawdown.toFixed(1)}%`} color={C.red} />
        <StatCard label="P&L" value={`${backtest.pnl >= 0 ? '+' : ''}${backtest.pnl.toFixed(2)}%`} color={backtest.pnl >= 0 ? C.green : C.red} />
      </div>

      {/* entry / exit / stop */}
      {(signal.entry !== undefined || signal.exit !== undefined || signal.stop !== undefined) && (
        <div style={{
          display: 'flex', gap: 16, padding: '14px 16px', background: 'rgba(255,255,255,0.02)',
          border: `1px solid ${C.border}`, borderRadius: 10,
        }}>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, textTransform: 'uppercase' }}>Levels:</div>
          {signal.entry !== undefined && (
            <div style={{ fontSize: 12, fontFamily: C.mono }}>
              <span style={{ color: C.dim }}>Entry </span><span style={{ color: C.green }}>{signal.entry.toFixed(2)}</span>
            </div>
          )}
          {signal.exit !== undefined && (
            <div style={{ fontSize: 12, fontFamily: C.mono }}>
              <span style={{ color: C.dim }}>Exit </span><span style={{ color: C.gold }}>{signal.exit.toFixed(2)}</span>
            </div>
          )}
          {signal.stop !== undefined && (
            <div style={{ fontSize: 12, fontFamily: C.mono }}>
              <span style={{ color: C.dim }}>Stop </span><span style={{ color: C.red }}>{signal.stop.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* mini equity curve */}
      {backtest.equityCurve && backtest.equityCurve.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Equity Curve
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 60, gap: 1 }}>
            {(() => {
              const ec = backtest.equityCurve;
              const mn = Math.min(...ec);
              const mx = Math.max(...ec);
              const rng = mx - mn || 1;
              return ec.map((v, i) => (
                <div key={i} style={{
                  flex: 1, height: `${((v - mn) / rng) * 100}%`,
                  background: v >= ec[0] ? C.green + '60' : C.red + '60',
                  borderRadius: '1px 1px 0 0',
                }} />
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── main page ─────────────────────────────────────────────────── */

export default function PairsPage() {
  const [pairs, setPairs] = useState<PairScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [customSymbols, setCustomSymbols] = useState('');
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [detail, setDetail] = useState<PairDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async (symbols: string) => {
    setLoading(true);
    setError(null);
    setPairs([]);
    setSelectedPair(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/pairs?symbols=${encodeURIComponent(symbols)}`);
      if (!res.ok) throw new Error(`Scanner returned ${res.status}`);
      const data = await res.json();
      setPairs(data.pairs ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (a: string, b: string) => {
    const key = `${a}/${b}`;
    if (selectedPair === key) {
      setSelectedPair(null);
      setDetail(null);
      return;
    }
    setSelectedPair(key);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/pairs?detail=true&a=${a}&b=${b}&lookback=90`);
      if (!res.ok) throw new Error(`Detail returned ${res.status}`);
      const data: PairDetail = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <AppShell>
      <ErrorBoundary label="Pairs">
      <div style={{ maxWidth: 1100 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <GitCompare size={28} color={C.purple} />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Statistical Arbitrage Lab</h1>
        </div>
        <p style={{ color: C.muted, fontSize: 14, margin: '0 0 28px' }}>
          Scan equity pairs for cointegration, z-score signals, and backtest performance
        </p>

        {/* action buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => scan(DEFAULT_SYMBOLS)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 10, border: `1px solid ${C.purple}`,
              background: `${C.purple}18`, color: C.purple, fontSize: 13, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer', fontFamily: C.mono,
            }}
          >
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            Scan Tech Giants
          </button>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={customSymbols}
              onChange={e => setCustomSymbols(e.target.value)}
              placeholder="AAPL,MSFT,GOOGL..."
              style={{
                padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.border}`,
                background: C.surface, color: C.text, fontSize: 13, fontFamily: C.mono,
                width: 240, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = C.purple; }}
              onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
              onKeyDown={e => { if (e.key === 'Enter' && customSymbols.trim()) scan(customSymbols.trim()); }}
            />
            <button
              onClick={() => customSymbols.trim() && scan(customSymbols.trim())}
              disabled={loading || !customSymbols.trim()}
              style={{
                padding: '10px 20px', borderRadius: 10, border: `1px solid ${C.border}`,
                background: C.surface, color: C.text, fontSize: 13, fontWeight: 600,
                cursor: loading || !customSymbols.trim() ? 'not-allowed' : 'pointer',
                fontFamily: C.mono, opacity: !customSymbols.trim() ? 0.5 : 1,
              }}
            >
              Scan Custom
            </button>
          </div>
        </div>

        {/* error */}
        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 20,
            background: `${C.red}12`, border: `1px solid ${C.red}30`, color: C.red,
            fontSize: 13, fontFamily: C.mono,
          }}>
            {error}
          </div>
        )}

        {/* pairs scanner table */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
          overflow: 'hidden',
        }}>
          <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Pair', 'Correlation', 'Coint. p-value', 'Half-Life', 'Z-Score', 'Signal', 'BT Sharpe'].map(h => (
                  <th key={h} style={{
                    padding: '12px 12px', textAlign: 'left', fontSize: 10,
                    color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em',
                    fontFamily: C.mono, fontWeight: 600,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingSkeleton />}
              {!loading && pairs.length === 0 && !error && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>
                    <Activity size={32} color={C.dim} style={{ marginBottom: 12, opacity: 0.4 }} />
                    <div>No pairs scanned yet. Hit <span style={{ color: C.purple, fontWeight: 600 }}>Scan Tech Giants</span> or enter custom symbols.</div>
                  </td>
                </tr>
              )}
              {!loading && pairs.map(p => {
                const key = `${p.symbolA}/${p.symbolB}`;
                const isSelected = selectedPair === key;
                return (
                  <tbody key={key}>
                    <tr
                      onClick={() => loadDetail(p.symbolA, p.symbolB)}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        cursor: 'pointer',
                        background: isSelected ? `${C.purple}08` : 'transparent',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={{ padding: '14px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: C.text, fontWeight: 700, fontFamily: C.mono, fontSize: 13 }}>{p.symbolA}</span>
                          <span style={{ color: C.dim, fontSize: 11 }}>/</span>
                          <span style={{ color: C.cyan, fontWeight: 700, fontFamily: C.mono, fontSize: 13 }}>{p.symbolB}</span>
                          {isSelected ? <ChevronUp size={12} color={C.dim} /> : <ChevronDown size={12} color={C.dim} />}
                        </div>
                      </td>
                      <td style={{ padding: '14px 12px', fontFamily: C.mono, fontSize: 13, color: C.text }}>{p.correlation.toFixed(3)}</td>
                      <td style={{
                        padding: '14px 12px', fontFamily: C.mono, fontSize: 13,
                        color: p.cointegrationPValue < 0.05 ? C.green : p.cointegrationPValue < 0.1 ? C.gold : C.red,
                      }}>
                        {p.cointegrationPValue.toFixed(4)}
                      </td>
                      <td style={{ padding: '14px 12px', fontFamily: C.mono, fontSize: 13, color: C.text }}>{p.halfLife.toFixed(1)}d</td>
                      <td style={{ padding: '14px 12px', fontFamily: C.mono, fontSize: 13, color: zScoreColor(p.zScore), fontWeight: 700 }}>
                        {p.zScore >= 0 ? '+' : ''}{p.zScore.toFixed(2)}
                      </td>
                      <td style={{ padding: '14px 12px' }}>{signalBadge(p.signal.action)}</td>
                      <td style={{
                        padding: '14px 12px', fontFamily: C.mono, fontSize: 13,
                        color: p.backtest.sharpe >= 1 ? C.green : p.backtest.sharpe >= 0.5 ? C.gold : C.red,
                        fontWeight: 600,
                      }}>
                        {p.backtest.sharpe.toFixed(2)}
                      </td>
                    </tr>
                    {/* detail row */}
                    {isSelected && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 16px 16px', background: `${C.purple}04` }}>
                          {detailLoading && (
                            <div style={{ padding: 30, textAlign: 'center' }}>
                              <Loader2 size={20} color={C.purple} style={{ animation: 'spin 1s linear infinite' }} />
                              <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>Loading pair detail...</div>
                            </div>
                          )}
                          {!detailLoading && detail && <DetailPanel detail={detail} />}
                          {!detailLoading && !detail && (
                            <div style={{ padding: 20, textAlign: 'center', color: C.dim, fontSize: 12 }}>
                              Failed to load detail for this pair.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
