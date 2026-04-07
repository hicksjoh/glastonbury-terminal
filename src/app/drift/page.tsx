'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TrendingUp, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface FactorWeights {
  momentum: number;
  meanReversion: number;
  value: number;
  income: number;
}

interface DriftScan {
  symbol: string;
  regime: 'trending' | 'mean_reverting' | 'random_walk';
  hurstExponent: number;
  autocorrelation: number;
  confidence: number;
  recommendedStrategy: string;
  factorWeights: FactorWeights;
}

interface DriftSummary {
  trending: number;
  meanReverting: number;
  randomWalk: number;
}

interface DriftResponse {
  scans: DriftScan[];
  summary: DriftSummary;
  timestamp: string;
}

const DEFAULT_SYMBOLS = 'SPY,QQQ,AAPL,MSFT,NVDA,TSLA,AMZN,GOOGL,META';

const COLORS = {
  bg: '#0a0a1a',
  surface: '#1a1a24',
  border: '#2a2a3a',
  purple: '#8a5cf6',
  gold: '#f0c674',
  green: '#4ade80',
  red: '#f87171',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  gray: '#6b7280',
  textPrimary: '#e5e5e5',
  textSecondary: '#9ca3af',
  hoverRow: '#1a1a2e',
};

function regimeColor(regime: string): string {
  if (regime === 'trending') return COLORS.green;
  if (regime === 'mean_reverting') return COLORS.blue;
  return COLORS.gray;
}

function regimeLabel(regime: string): string {
  if (regime === 'trending') return 'TRENDING';
  if (regime === 'mean_reverting') return 'MEAN REVERTING';
  return 'RANDOM WALK';
}

function hurstColor(hurst: number): string {
  if (hurst > 0.6) return COLORS.green;
  if (hurst < 0.4) return COLORS.blue;
  return COLORS.gray;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div
            style={{
              height: 16,
              borderRadius: 4,
              background: 'linear-gradient(90deg, #1a1a24 25%, #2a2a3a 50%, #1a1a24 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }}
          />
        </td>
      ))}
    </tr>
  );
}

function FactorBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: COLORS.textSecondary, width: 100, textTransform: 'capitalize' }}>
        {label === 'meanReversion' ? 'Mean Reversion' : label}
      </span>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 4,
          backgroundColor: COLORS.border,
          overflow: 'hidden',
          maxWidth: 160,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 4,
            backgroundColor:
              label === 'momentum'
                ? COLORS.purple
                : label === 'meanReversion'
                  ? COLORS.cyan
                  : label === 'value'
                    ? COLORS.gold
                    : COLORS.green,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: COLORS.textSecondary, width: 36, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  );
}

export default function DriftPage() {
  const [data, setData] = useState<DriftResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customSymbols, setCustomSymbols] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const fetchDrift = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DriftResponse = await res.json();
      json.scans.sort((a, b) => b.confidence - a.confidence);
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch drift data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrift(`/api/drift?symbols=${DEFAULT_SYMBOLS}`);
  }, []);

  const scanDefaults = () => fetchDrift(`/api/drift?symbols=${DEFAULT_SYMBOLS}`);
  const scanWatchlist = () => fetchDrift('/api/drift?watchlist=true');
  const scanCustom = () => {
    const syms = customSymbols.trim().toUpperCase().replace(/\s+/g, ',');
    if (syms) fetchDrift(`/api/drift?symbols=${syms}`);
  };

  const toggleExpand = (symbol: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  return (
    <AppShell>
      <ErrorBoundary label="Drift">
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', color: COLORS.textPrimary }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${COLORS.purple}, ${COLORS.cyan})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TrendingUp size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Drift Regime Scanner
            </h1>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>
              Hurst exponent & autocorrelation analysis
            </p>
          </div>
          {data?.timestamp && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: COLORS.textSecondary,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {new Date(data.timestamp).toLocaleString()}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={scanDefaults}
            disabled={loading}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: COLORS.purple,
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            Scan Defaults
          </button>
          <button
            onClick={scanWatchlist}
            disabled={loading}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.surface,
              color: COLORS.textPrimary,
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            Scan Watchlist
          </button>
          <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
            <input
              type="text"
              placeholder="AAPL, TSLA, ..."
              value={customSymbols}
              onChange={(e) => setCustomSymbols(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scanCustom()}
              style={{
                padding: '10px 14px',
                borderRadius: '8px 0 0 8px',
                border: `1px solid ${COLORS.border}`,
                borderRight: 'none',
                background: COLORS.surface,
                color: COLORS.textPrimary,
                fontSize: 13,
                outline: 'none',
                width: 180,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <button
              onClick={scanCustom}
              disabled={loading || !customSymbols.trim()}
              style={{
                padding: '10px 16px',
                borderRadius: '0 8px 8px 0',
                border: `1px solid ${COLORS.border}`,
                background: COLORS.cyan,
                color: '#0a0a1a',
                fontWeight: 700,
                fontSize: 13,
                cursor: loading || !customSymbols.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !customSymbols.trim() ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              Scan Custom
            </button>
          </div>
          {loading && (
            <Loader2
              size={18}
              color={COLORS.purple}
              style={{ animation: 'spin 1s linear infinite' }}
            />
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 8,
              backgroundColor: 'rgba(248,113,113,0.1)',
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {data?.summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
            {([
              { label: 'Trending', count: data.summary.trending, color: COLORS.green },
              { label: 'Mean-Reverting', count: data.summary.meanReverting, color: COLORS.blue },
              { label: 'Random Walk', count: data.summary.randomWalk, color: COLORS.gray },
            ] as const).map((card) => (
              <div
                key={card.label}
                style={{
                  padding: '20px 24px',
                  borderRadius: 12,
                  backgroundColor: COLORS.surface,
                  border: `1px solid ${COLORS.border}`,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    backgroundColor: card.color,
                  }}
                />
                <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '0 0 6px' }}>
                  {card.label}
                </p>
                <p
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    margin: 0,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: card.color,
                  }}
                >
                  {card.count}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Results Table */}
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.surface,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${COLORS.border}`,
                  fontSize: 12,
                  color: COLORS.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }} />
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Symbol</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Regime</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>Hurst</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>Autocorr</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Confidence</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : data?.scans.map((scan) => {
                    const isExpanded = expandedRows.has(scan.symbol);
                    const isHovered = hoveredRow === scan.symbol;
                    return (
                      <>
                        <tr
                          key={scan.symbol}
                          onClick={() => toggleExpand(scan.symbol)}
                          onMouseEnter={() => setHoveredRow(scan.symbol)}
                          onMouseLeave={() => setHoveredRow(null)}
                          style={{
                            borderBottom: isExpanded ? 'none' : `1px solid ${COLORS.border}`,
                            cursor: 'pointer',
                            backgroundColor: isHovered ? COLORS.hoverRow : 'transparent',
                            transition: 'background-color 0.15s',
                          }}
                        >
                          <td style={{ padding: '14px 8px 14px 16px', width: 28 }}>
                            {isExpanded ? (
                              <ChevronDown size={14} color={COLORS.textSecondary} />
                            ) : (
                              <ChevronRight size={14} color={COLORS.textSecondary} />
                            )}
                          </td>
                          <td
                            style={{
                              padding: '14px 16px',
                              fontWeight: 700,
                              fontSize: 14,
                              fontFamily: "'JetBrains Mono', monospace",
                              color: COLORS.gold,
                            }}
                          >
                            {scan.symbol}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                color: regimeColor(scan.regime),
                                backgroundColor: `${regimeColor(scan.regime)}18`,
                                border: `1px solid ${regimeColor(scan.regime)}30`,
                              }}
                            >
                              {regimeLabel(scan.regime)}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: '14px 16px',
                              textAlign: 'right',
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 13,
                              color: hurstColor(scan.hurstExponent),
                              fontWeight: 600,
                            }}
                          >
                            {scan.hurstExponent.toFixed(3)}
                          </td>
                          <td
                            style={{
                              padding: '14px 16px',
                              textAlign: 'right',
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 13,
                              color: COLORS.textPrimary,
                            }}
                          >
                            {scan.autocorrelation >= 0 ? '+' : ''}
                            {scan.autocorrelation.toFixed(3)}
                          </td>
                          <td style={{ padding: '14px 16px', minWidth: 140 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div
                                style={{
                                  flex: 1,
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor: COLORS.border,
                                  overflow: 'hidden',
                                  maxWidth: 100,
                                }}
                              >
                                <div
                                  style={{
                                    width: `${Math.round(scan.confidence * 100)}%`,
                                    height: '100%',
                                    borderRadius: 3,
                                    backgroundColor:
                                      scan.confidence >= 0.7
                                        ? COLORS.green
                                        : scan.confidence >= 0.4
                                          ? COLORS.gold
                                          : COLORS.red,
                                    transition: 'width 0.4s ease',
                                  }}
                                />
                              </div>
                              <span
                                style={{
                                  fontFamily: "'JetBrains Mono', monospace",
                                  fontSize: 12,
                                  color: COLORS.textSecondary,
                                  minWidth: 36,
                                }}
                              >
                                {Math.round(scan.confidence * 100)}%
                              </span>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '14px 16px',
                              fontSize: 13,
                              color: COLORS.textSecondary,
                            }}
                          >
                            {scan.recommendedStrategy}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr
                            key={`${scan.symbol}-factors`}
                            style={{ borderBottom: `1px solid ${COLORS.border}` }}
                          >
                            <td colSpan={7} style={{ padding: '0 16px 16px 56px' }}>
                              <div
                                style={{
                                  padding: 16,
                                  borderRadius: 8,
                                  backgroundColor: COLORS.bg,
                                  border: `1px solid ${COLORS.border}`,
                                }}
                              >
                                <p
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: COLORS.textSecondary,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    margin: '0 0 10px',
                                  }}
                                >
                                  Factor Weights
                                </p>
                                <FactorBar label="momentum" value={scan.factorWeights.momentum} />
                                <FactorBar label="meanReversion" value={scan.factorWeights.meanReversion} />
                                <FactorBar label="value" value={scan.factorWeights.value} />
                                <FactorBar label="income" value={scan.factorWeights.income} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
            </tbody>
          </table>

          {!loading && data?.scans.length === 0 && (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: COLORS.textSecondary,
                fontSize: 14,
              }}
            >
              No scan results. Try scanning with different symbols.
            </div>
          )}
        </div>
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
