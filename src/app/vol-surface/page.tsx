'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layers, RefreshCw } from 'lucide-react';

/* ── colour palette ──────────────────────────────────────────── */
const C = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
  muted: '#888',
  text: '#fff',
};

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

/* ── types ───────────────────────────────────────────────────── */
interface GridPoint {
  strike: number;
  expiry: string;
  iv: number;
  delta?: number;
}

interface SkewAnalysis {
  skewType: string;
  putSkew25d: number;
  callSkew25d: number;
  riskReversal: number;
  butterfly: number;
  skewSlope: number;
  interpretation: string;
}

interface TermPoint {
  expiry: string;
  iv: number;
}

interface Mispricing {
  strike: number;
  expiry: string;
  type: string;
  currentIV: number;
  expectedIV: number;
  edge: number;
  direction: string;
}

interface VolSurfaceData {
  symbol: string;
  spotPrice: number;
  surface: {
    grid: GridPoint[];
    strikes: number[];
    expirations: string[];
  };
  skewAnalysis: SkewAnalysis;
  termStructure: {
    points: TermPoint[];
    shape: string;
  };
  mispricings: Mispricing[];
  lastUpdated: string;
}

/* ── symbols ─────────────────────────────────────────────────── */
const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'SPY'];

/* ── helpers ─────────────────────────────────────────────────── */
function ivColor(iv: number, minIV: number, maxIV: number): string {
  const t = maxIV === minIV ? 0.5 : (iv - minIV) / (maxIV - minIV);
  // blue #3b82f6 → red #ef4444
  const r = Math.round(59 + t * (239 - 59));
  const g = Math.round(130 + t * (68 - 130));
  const b = Math.round(246 + t * (68 - 246));
  return `rgb(${r}, ${g}, ${b})`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/* ── skeleton ────────────────────────────────────────────────── */
function Skeleton({ width, height }: { width: string | number; height: string | number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background: `linear-gradient(90deg, ${C.surface} 25%, #252530 50%, ${C.surface} 75%)`,
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Skeleton width="100%" height={300} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Skeleton width="100%" height={200} />
          <Skeleton width="100%" height={200} />
        </div>
        <Skeleton width="100%" height={180} />
      </div>
    </>
  );
}

/* ── badge component ─────────────────────────────────────────── */
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: MONO,
        color,
        background: `${color}18`,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
}

/* ── card wrapper ────────────────────────────────────────────── */
function Card({ title, children, style: s }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 20,
        ...s,
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: C.text }}>{title}</h3>
      {children}
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────── */
export default function VolSurfacePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [data, setData] = useState<VolSurfaceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/vol-surface?symbol=${symbol}`);
        if (res.ok && !cancelled) {
          setData(await res.json());
        }
      } catch (err) {
        console.error('Vol surface fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [symbol]);

  /* ── derived values for heatmap ── */
  const allIVs = data ? data.surface.grid.map((p) => p.iv) : [];
  const minIV = allIVs.length ? Math.min(...allIVs) : 0;
  const maxIV = allIVs.length ? Math.max(...allIVs) : 1;

  /* build lookup: expiry-strike → iv */
  const ivLookup: Record<string, number> = {};
  if (data) {
    for (const p of data.surface.grid) {
      ivLookup[`${p.expiry}-${p.strike}`] = p.iv;
    }
  }

  /* term structure chart scaling */
  const termIVs = data ? data.termStructure.points.map((p) => p.iv) : [];
  const termMin = termIVs.length ? Math.min(...termIVs) : 0;
  const termMax = termIVs.length ? Math.max(...termIVs) : 1;
  const termRange = termMax - termMin || 0.01;

  return (
    <ErrorBoundary label="VolSurface">
    <AppShell>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div>
        {/* ── HEADER ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Layers size={24} color={C.purple} />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: 0 }}>Volatility Surface</h1>

          {/* symbol selector */}
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              fontSize: 13,
              fontFamily: MONO,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <p style={{ color: C.muted, fontSize: 14, margin: '0 0 24px' }}>
          Implied volatility heatmap, skew analysis &amp; mispricing detection
          {data && (
            <span style={{ marginLeft: 12, fontFamily: MONO, fontSize: 12, color: C.purple }}>
              Spot ${data.spotPrice.toFixed(2)}
            </span>
          )}
        </p>

        {loading ? (
          <LoadingSkeleton />
        ) : !data ? (
          <div style={{ color: C.muted, textAlign: 'center', padding: 80 }}>No data available</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* ── 3D HEATMAP ──────────────────────────────────── */}
            <Card title="IV Surface Heatmap">
              <div style={{ overflowX: 'auto' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `120px repeat(${data.surface.strikes.length}, minmax(54px, 1fr))`,
                    gap: 2,
                  }}
                >
                  {/* top-left corner */}
                  <div style={{ fontSize: 10, color: C.muted, padding: 4, textAlign: 'center' }}>
                    Strike &rarr;
                  </div>

                  {/* strike labels (top row) */}
                  {data.surface.strikes.map((strike) => (
                    <div
                      key={`sh-${strike}`}
                      style={{
                        textAlign: 'center',
                        fontSize: 10,
                        fontFamily: MONO,
                        color: C.gold,
                        padding: '4px 0',
                      }}
                    >
                      {strike}
                    </div>
                  ))}

                  {/* rows: one per expiration */}
                  {data.surface.expirations.map((expiry) => (
                    <>
                      {/* expiration label */}
                      <div
                        key={`el-${expiry}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: 11,
                          fontFamily: MONO,
                          color: C.cyan,
                          padding: '0 6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {expiry}
                      </div>

                      {/* IV cells */}
                      {data.surface.strikes.map((strike) => {
                        const iv = ivLookup[`${expiry}-${strike}`];
                        if (iv === undefined) {
                          return (
                            <div
                              key={`c-${expiry}-${strike}`}
                              style={{
                                background: '#111',
                                borderRadius: 4,
                                height: 36,
                              }}
                            />
                          );
                        }
                        return (
                          <div
                            key={`c-${expiry}-${strike}`}
                            title={`Strike: ${strike} | Expiry: ${expiry} | IV: ${pct(iv)}`}
                            style={{
                              background: ivColor(iv, minIV, maxIV),
                              borderRadius: 4,
                              height: 36,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              fontFamily: MONO,
                              color: '#fff',
                              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                              cursor: 'default',
                              transition: 'transform 0.1s',
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.15)';
                              (e.currentTarget as HTMLDivElement).style.zIndex = '10';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                              (e.currentTarget as HTMLDivElement).style.zIndex = '0';
                            }}
                          >
                            {pct(iv)}
                          </div>
                        );
                      })}
                    </>
                  ))}
                </div>
              </div>

              {/* legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <span style={{ fontSize: 10, color: C.muted }}>Low IV</span>
                <div
                  style={{
                    flex: 1,
                    maxWidth: 200,
                    height: 8,
                    borderRadius: 4,
                    background: 'linear-gradient(90deg, #3b82f6, #ef4444)',
                  }}
                />
                <span style={{ fontSize: 10, color: C.muted }}>High IV</span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginLeft: 8 }}>
                  Range: {pct(minIV)} &ndash; {pct(maxIV)}
                </span>
              </div>
            </Card>

            {/* ── SKEW + TERM STRUCTURE ROW ───────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* SKEW ANALYSIS */}
              <Card title="Skew Analysis">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* skew type badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: C.muted }}>Type</span>
                    <Badge
                      label={data.skewAnalysis.skewType}
                      color={
                        data.skewAnalysis.skewType.toLowerCase().includes('put')
                          ? C.red
                          : data.skewAnalysis.skewType.toLowerCase().includes('call')
                          ? C.green
                          : C.purple
                      }
                    />
                  </div>

                  {/* metrics grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { label: '25d Put Skew', value: pct(data.skewAnalysis.putSkew25d), color: C.red },
                      { label: '25d Call Skew', value: pct(data.skewAnalysis.callSkew25d), color: C.green },
                      { label: 'Risk Reversal', value: pct(data.skewAnalysis.riskReversal), color: data.skewAnalysis.riskReversal < 0 ? C.red : C.green },
                      { label: 'Butterfly', value: pct(data.skewAnalysis.butterfly), color: C.cyan },
                      { label: 'Skew Slope', value: data.skewAnalysis.skewSlope.toFixed(4), color: C.gold },
                    ].map((m) => (
                      <div
                        key={m.label}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: `${C.bg}`,
                          border: `1px solid ${C.border}`,
                        }}
                      >
                        <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{m.label}</div>
                        <div style={{ fontSize: 16, fontFamily: MONO, fontWeight: 600, color: m.color }}>
                          {m.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* interpretation */}
                  <div
                    style={{
                      fontSize: 12,
                      color: C.muted,
                      padding: '10px 12px',
                      background: C.bg,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      lineHeight: 1.5,
                    }}
                  >
                    {data.skewAnalysis.interpretation}
                  </div>
                </div>
              </Card>

              {/* TERM STRUCTURE */}
              <Card title="ATM Term Structure">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 12, color: C.muted }}>Shape</span>
                  <Badge
                    label={data.termStructure.shape}
                    color={
                      data.termStructure.shape.toLowerCase() === 'contango'
                        ? C.green
                        : data.termStructure.shape.toLowerCase() === 'backwardation'
                        ? C.red
                        : C.gold
                    }
                  />
                </div>

                {/* CSS line chart */}
                <div
                  style={{
                    position: 'relative',
                    height: 140,
                    background: C.bg,
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    padding: '16px 12px 28px',
                  }}
                >
                  {/* horizontal grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                    <div
                      key={`gl-${frac}`}
                      style={{
                        position: 'absolute',
                        left: 12,
                        right: 12,
                        top: `${16 + frac * 96}px`,
                        height: 1,
                        background: `${C.border}60`,
                      }}
                    />
                  ))}

                  {/* dots + connecting lines */}
                  {data.termStructure.points.map((pt, i, arr) => {
                    const x = arr.length > 1 ? (i / (arr.length - 1)) * 100 : 50;
                    const y = ((termMax - pt.iv) / termRange) * 96 + 16;

                    return (
                      <div key={`tp-${i}`}>
                        {/* line to next point */}
                        {i < arr.length - 1 && (() => {
                          const nextX = ((i + 1) / (arr.length - 1)) * 100;
                          const nextY = ((termMax - arr[i + 1].iv) / termRange) * 96 + 16;
                          const dx = (nextX - x);
                          const containerWidth = 1; // percentage-based, we use SVG instead
                          return null; // we draw a single SVG below
                        })()}

                        {/* dot */}
                        <div
                          title={`${pt.expiry}: ${pct(pt.iv)}`}
                          style={{
                            position: 'absolute',
                            left: `calc(${x}% - 4px + 12px * (1 - ${x}/100) - 12px * ${x}/100 + 12px)`,
                            top: y - 4,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: C.purple,
                            border: `2px solid ${C.text}`,
                            zIndex: 2,
                          }}
                        />

                        {/* expiry label */}
                        <div
                          style={{
                            position: 'absolute',
                            left: `calc(${x}% + 12px * (1 - ${x}/100) - 12px * ${x}/100 + 12px)`,
                            bottom: 2,
                            transform: 'translateX(-50%)',
                            fontSize: 8,
                            fontFamily: MONO,
                            color: C.muted,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {pt.expiry.slice(5)}
                        </div>
                      </div>
                    );
                  })}

                  {/* SVG overlay for connecting lines */}
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 12,
                      right: 12,
                      width: 'calc(100% - 24px)',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                    viewBox="0 0 100 128"
                    preserveAspectRatio="none"
                  >
                    {data.termStructure.points.length > 1 && (
                      <polyline
                        points={data.termStructure.points
                          .map((pt, i, arr) => {
                            const x = (i / (arr.length - 1)) * 100;
                            const y = ((termMax - pt.iv) / termRange) * 96 + 16;
                            return `${x},${y}`;
                          })
                          .join(' ')}
                        fill="none"
                        stroke={C.purple}
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                </div>
              </Card>
            </div>

            {/* ── MISPRICING ALERTS ────────────────────────────── */}
            <Card title="Mispricing Alerts">
              {data.mispricings.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 24 }}>
                  No mispricings detected
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Strike', 'Expiry', 'Type', 'Current IV', 'Expected IV', 'Edge', 'Direction'].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: 'left',
                                padding: '8px 10px',
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 500,
                                borderBottom: `1px solid ${C.border}`,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.mispricings.map((m, i) => {
                        const isOver = m.direction.toLowerCase().includes('over');
                        const dirColor = isOver ? C.red : C.green;
                        return (
                          <tr
                            key={i}
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLTableRowElement).style.background = `${C.border}30`;
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                            }}
                          >
                            <td style={{ padding: '10px', fontFamily: MONO, color: C.gold }}>
                              {m.strike}
                            </td>
                            <td style={{ padding: '10px', fontFamily: MONO, color: C.cyan }}>
                              {m.expiry}
                            </td>
                            <td style={{ padding: '10px', color: C.text }}>{m.type}</td>
                            <td style={{ padding: '10px', fontFamily: MONO, color: C.text }}>
                              {pct(m.currentIV)}
                            </td>
                            <td style={{ padding: '10px', fontFamily: MONO, color: C.muted }}>
                              {pct(m.expectedIV)}
                            </td>
                            <td style={{ padding: '10px', fontFamily: MONO, fontWeight: 600, color: dirColor }}>
                              {m.edge.toFixed(2)}%
                            </td>
                            <td style={{ padding: '10px' }}>
                              <Badge label={m.direction} color={dirColor} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── FOOTER ─────────────────────────────────────── */}
            <div style={{ textAlign: 'right', fontSize: 10, color: C.muted, fontFamily: MONO }}>
              Last updated: {new Date(data.lastUpdated).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </AppShell>
    </ErrorBoundary>
  );
}
