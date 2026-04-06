'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Zap, RefreshCw } from 'lucide-react';

interface StrikeGEX {
  strike: number;
  gex: number;
}

interface ExpirationEntry {
  expiration: string;
  gex: number;
}

interface GEXData {
  regime: string;
  levels: {
    putWall: number;
    callWall: number;
    gammaFlip: number;
    hvl: number;
  };
  byStrike: StrikeGEX[];
  impact: string;
  expirationBreakdown: ExpirationEntry[];
}

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META'];

const colors = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
};

function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

/** Validate that the API response has the expected shape */
function isValidGEXData(obj: unknown): obj is GEXData {
  if (!obj || typeof obj !== 'object') return false;
  const d = obj as Record<string, unknown>;
  return (
    typeof d.regime === 'string' &&
    d.levels != null &&
    typeof d.levels === 'object' &&
    Array.isArray(d.byStrike) &&
    typeof d.impact === 'string' &&
    Array.isArray(d.expirationBreakdown)
  );
}

function SkeletonCard({ height = 80 }: { height?: number }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        height,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

export default function GEXPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [data, setData] = useState<GEXData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGEX = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gex?symbol=${symbol}`);
      if (!res.ok) {
        setError(`API returned ${res.status}`);
        return;
      }
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      if (!isValidGEXData(json)) {
        setError('Unexpected data format from API');
        return;
      }
      setData(json);
    } catch (err) {
      console.error('GEX fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch GEX data');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchGEX();
    const interval = setInterval(fetchGEX, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchGEX]);

  const maxAbsGEX =
    data?.byStrike && data.byStrike.length > 0
      ? Math.max(...data.byStrike.map((s) => Math.abs(s.gex ?? 0)), 1)
      : 1;

  const isPositiveRegime = (data?.regime ?? '').toLowerCase().includes('positive');

  return (
    <AppShell>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div style={{ background: colors.bg, minHeight: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Zap size={24} color={colors.purple} />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>GEX Dashboard</h1>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              marginLeft: 16,
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: '#fff',
              fontSize: 14,
              fontFamily: '"JetBrains Mono", monospace',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={fetchGEX}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, border: `1px solid ${colors.border}`,
              background: 'rgba(255,255,255,0.03)', color: '#888', fontSize: 12, cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>
          Gamma exposure analysis &bull; key levels, regime, strike distribution
        </p>

        {loading && !data ? (
          /* Loading Skeletons */
          <div>
            <SkeletonCard height={60} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 16 }}>
              {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} height={100} />)}
            </div>
            <SkeletonCard height={300} />
            <div style={{ marginTop: 16 }}><SkeletonCard height={120} /></div>
            <div style={{ marginTop: 16 }}><SkeletonCard height={200} /></div>
          </div>
        ) : data ? (
          <div>
            {/* Regime Badge */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 24px',
                  borderRadius: 10,
                  background: isPositiveRegime
                    ? 'rgba(74, 222, 128, 0.15)'
                    : 'rgba(248, 113, 113, 0.15)',
                  border: `1px solid ${isPositiveRegime ? colors.green : colors.red}`,
                  fontSize: 18,
                  fontWeight: 700,
                  color: isPositiveRegime ? colors.green : colors.red,
                  fontFamily: '"JetBrains Mono", monospace',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {isPositiveRegime ? '\u25B2' : '\u25BC'} {data.regime}
              </div>
            </div>

            {/* Key Levels Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
              {[
                { label: 'Put Wall', value: data.levels.putWall, color: colors.red },
                { label: 'Call Wall', value: data.levels.callWall, color: colors.green },
                { label: 'Gamma Flip', value: data.levels.gammaFlip, color: colors.cyan },
                { label: 'HVL', value: data.levels.hvl, color: colors.gold },
              ].map((card) => (
                <div
                  key={card.label}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      color: card.color,
                      fontSize: 26,
                      fontWeight: 700,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    {card.value != null ? card.value.toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* GEX by Strike Chart */}
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                marginBottom: 24,
              }}
            >
              <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 600, margin: '0 0 20px' }}>GEX by Strike</h2>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 220, position: 'relative' }}>
                {/* Zero line */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: '50%',
                    height: 1,
                    background: 'rgba(255,255,255,0.1)',
                  }}
                />
                {(data.byStrike ?? []).map((item, idx) => {
                  const pct = (item.gex / maxAbsGEX) * 50;
                  const isPositive = item.gex >= 0;
                  return (
                    <div
                      key={idx}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        height: '100%',
                        position: 'relative',
                      }}
                    >
                      {/* Bar */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '10%',
                          right: '10%',
                          ...(isPositive
                            ? { bottom: '50%', height: `${Math.abs(pct)}%` }
                            : { top: '50%', height: `${Math.abs(pct)}%` }),
                          background: isPositive ? colors.green : colors.red,
                          borderRadius: isPositive ? '3px 3px 0 0' : '0 0 3px 3px',
                          opacity: 0.85,
                          transition: 'height 0.3s ease',
                        }}
                        title={`Strike ${item.strike}: ${formatNumber(item.gex)}`}
                      />
                      {/* Strike label */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: -20,
                          fontSize: 9,
                          color: '#666',
                          fontFamily: '"JetBrains Mono", monospace',
                          transform: 'rotate(-45deg)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.strike}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* X-axis area for labels */}
              <div style={{ height: 24 }} />
            </div>

            {/* Impact Assessment Card */}
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${colors.purple}`,
                borderRadius: 12,
                padding: '20px 24px',
                marginBottom: 24,
              }}
            >
              <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 1 }}>
                Impact Assessment
              </h2>
              <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.7, margin: 0 }}>{data.impact}</p>
            </div>

            {/* Expiration Breakdown Table */}
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 600, padding: '16px 24px 12px', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>
                Expiration Breakdown
              </h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 24px', color: '#888', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Expiry
                    </th>
                    <th style={{ textAlign: 'right', padding: '10px 24px', color: '#888', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Total GEX
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(data.expirationBreakdown ?? []).map((row, idx) => (
                    <tr
                      key={idx}
                      style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'default' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a2e')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px 24px', color: '#ccc', fontSize: 13 }}>{row.expiration}</td>
                      <td
                        style={{
                          padding: '10px 24px',
                          textAlign: 'right',
                          color: (row.gex ?? 0) >= 0 ? colors.green : colors.red,
                          fontSize: 13,
                          fontFamily: '"JetBrains Mono", monospace',
                          fontWeight: 600,
                        }}
                      >
                        {formatNumber(row.gex)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ color: colors.red, fontSize: 16, marginBottom: 16 }}>{error}</div>
            <button
              onClick={fetchGEX}
              style={{
                padding: '10px 24px',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>No data available.</div>
        )}
      </div>
    </AppShell>
  );
}
