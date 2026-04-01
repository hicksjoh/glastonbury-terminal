'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Globe } from 'lucide-react';

interface FactorDetail {
  score: number;
  signal: string;
}

interface MacroData {
  regime: {
    regime: string;
    confidence: number;
    score: number;
    factorBreakdown: Record<string, FactorDetail>;
  };
  indicators: {
    yield10Y: number;
    yield2Y: number;
    yieldCurveSlope: number;
    fedFunds: number;
    vix: number;
    dxy: number;
    creditSpread: number;
  };
  fedPrediction: {
    prediction: 'hike' | 'hold' | 'cut';
    confidence: number;
    impliedRate: number;
  };
  allocation: {
    equities: number;
    bonds: number;
    commodities: number;
    cash: number;
    alternatives: number;
  };
  upcomingEvents: { date: string; event: string; importance: string }[];
  interpretation: string;
  lastUpdated: string;
}

const REGIME_COLORS: Record<string, string> = {
  expansion: '#4ade80',
  late_cycle: '#f0c674',
  slowdown: '#fb923c',
  recession: '#f87171',
  recovery: '#22d3ee',
  reflation: '#8a5cf6',
};

const SIGNAL_COLORS: Record<string, string> = {
  bullish: '#4ade80',
  neutral: '#f0c674',
  bearish: '#f87171',
  positive: '#4ade80',
  negative: '#f87171',
  caution: '#f0c674',
  elevated: '#f87171',
  low: '#4ade80',
  normal: '#f0c674',
  high: '#f87171',
};

const FED_COLORS: Record<string, string> = {
  hike: '#f87171',
  hold: '#f0c674',
  cut: '#4ade80',
};

const ALLOC_COLORS: Record<string, string> = {
  equities: '#8a5cf6',
  bonds: '#22d3ee',
  commodities: '#f0c674',
  cash: '#4ade80',
  alternatives: '#fb923c',
};

function getSignalColor(signal: string): string {
  const lower = signal.toLowerCase();
  return SIGNAL_COLORS[lower] || '#a0a0b0';
}

function SkeletonBlock({ width, height }: { width?: string; height?: string }) {
  return (
    <div
      style={{
        width: width || '100%',
        height: height || '20px',
        backgroundColor: '#1a1a24',
        borderRadius: 6,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
      <SkeletonBlock height="80px" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} height="100px" />
        ))}
      </div>
      <SkeletonBlock height="120px" />
      <SkeletonBlock height="60px" />
      <SkeletonBlock height="200px" />
      <SkeletonBlock height="140px" />
    </div>
  );
}

export default function MacroPage() {
  const [data, setData] = useState<MacroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/macro');
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('Macro fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load macro data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const regimeColor = data ? (REGIME_COLORS[data.regime.regime] || '#a0a0b0') : '#a0a0b0';

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <Globe size={28} color="#8a5cf6" />
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#e0e0e0', margin: 0 }}>
            Macro Regime Dashboard
          </h1>
        </div>

        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div style={{
            backgroundColor: '#1a1a24',
            border: '1px solid #f87171',
            borderRadius: 10,
            padding: 24,
            color: '#f87171',
            textAlign: 'center',
          }}>
            {error}
          </div>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* 1. Regime Badge */}
            <div style={{
              backgroundColor: '#1a1a24',
              border: `1px solid ${regimeColor}40`,
              borderRadius: 12,
              padding: 28,
              textAlign: 'center',
            }}>
              <div style={{
                display: 'inline-block',
                padding: '10px 32px',
                borderRadius: 8,
                backgroundColor: `${regimeColor}18`,
                border: `2px solid ${regimeColor}`,
                marginBottom: 16,
              }}>
                <span style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: regimeColor,
                  letterSpacing: 3,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {data.regime.regime.toUpperCase().replace('_', ' ')}
                </span>
              </div>
              <div style={{ color: '#a0a0b0', fontSize: 13, marginBottom: 8 }}>
                Confidence: {(data.regime.confidence * 100).toFixed(1)}%
              </div>
              <div style={{
                width: '60%',
                margin: '0 auto',
                height: 8,
                backgroundColor: '#2a2a3a',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${data.regime.confidence * 100}%`,
                  height: '100%',
                  backgroundColor: regimeColor,
                  borderRadius: 4,
                  transition: 'width 0.6s ease',
                }} />
              </div>
              <div style={{
                color: '#a0a0b0',
                fontSize: 12,
                marginTop: 10,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                Composite Score: {data.regime.score.toFixed(2)}
              </div>
            </div>

            {/* 2. Macro Indicators Grid */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginBottom: 14 }}>
                Macro Indicators
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                {(() => {
                  const ind = data.indicators;
                  const fb = data.regime.factorBreakdown;
                  const cards: { label: string; value: string; key: string }[] = [
                    { label: 'Yield Curve (10Y-2Y)', value: `${ind.yieldCurveSlope.toFixed(2)}%`, key: 'yieldCurve' },
                    { label: 'Credit Spread', value: `${ind.creditSpread.toFixed(2)}%`, key: 'creditSpread' },
                    { label: 'VIX', value: ind.vix.toFixed(2), key: 'vix' },
                    { label: 'DXY', value: ind.dxy.toFixed(2), key: 'dxy' },
                    { label: 'Fed Funds', value: `${ind.fedFunds.toFixed(2)}%`, key: 'fedFunds' },
                    { label: '10Y Yield', value: `${ind.yield10Y.toFixed(2)}%`, key: 'yield10Y' },
                    { label: '2Y Yield', value: `${ind.yield2Y.toFixed(2)}%`, key: 'yield2Y' },
                  ];
                  // Add optional indicators from factorBreakdown
                  const optional = ['unemployment', 'ism', 'cpi'];
                  optional.forEach(k => {
                    if (fb[k]) {
                      cards.push({
                        label: k.toUpperCase(),
                        value: fb[k].score.toFixed(2),
                        key: k,
                      });
                    }
                  });
                  return cards.slice(0, 8).map(card => {
                    const factor = fb[card.key];
                    const color = factor ? getSignalColor(factor.signal) : '#a0a0b0';
                    return (
                      <div key={card.key} style={{
                        backgroundColor: '#1a1a24',
                        border: '1px solid #2a2a3a',
                        borderRadius: 10,
                        padding: 18,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}>
                        <div style={{ fontSize: 12, color: '#a0a0b0', fontWeight: 500 }}>
                          {card.label}
                        </div>
                        <div style={{
                          fontSize: 22,
                          fontWeight: 700,
                          color,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>
                          {card.value}
                        </div>
                        {factor && (
                          <div style={{
                            fontSize: 11,
                            color,
                            opacity: 0.8,
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                          }}>
                            {factor.signal}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* 3. Fed Watch */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginBottom: 14 }}>
                Fed Watch
              </h2>
              <div style={{
                backgroundColor: '#1a1a24',
                border: '1px solid #2a2a3a',
                borderRadius: 12,
                padding: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 32,
              }}>
                <div style={{
                  display: 'inline-block',
                  padding: '12px 28px',
                  borderRadius: 8,
                  backgroundColor: `${FED_COLORS[data.fedPrediction.prediction] || '#a0a0b0'}18`,
                  border: `2px solid ${FED_COLORS[data.fedPrediction.prediction] || '#a0a0b0'}`,
                }}>
                  <span style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: FED_COLORS[data.fedPrediction.prediction] || '#a0a0b0',
                    letterSpacing: 3,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {data.fedPrediction.prediction.toUpperCase()}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#a0a0b0', fontSize: 12, marginBottom: 6 }}>
                    Confidence: {(data.fedPrediction.confidence * 100).toFixed(1)}%
                  </div>
                  <div style={{
                    height: 8,
                    backgroundColor: '#2a2a3a',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${data.fedPrediction.confidence * 100}%`,
                      height: '100%',
                      backgroundColor: FED_COLORS[data.fedPrediction.prediction] || '#a0a0b0',
                      borderRadius: 4,
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#a0a0b0', fontSize: 12 }}>Implied Rate</div>
                  <div style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#e0e0e0',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {data.fedPrediction.impliedRate.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Asset Allocation */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginBottom: 14 }}>
                Recommended Allocation
              </h2>
              <div style={{
                backgroundColor: '#1a1a24',
                border: '1px solid #2a2a3a',
                borderRadius: 12,
                padding: 24,
              }}>
                {/* Stacked bar */}
                <div style={{
                  display: 'flex',
                  height: 36,
                  borderRadius: 6,
                  overflow: 'hidden',
                  marginBottom: 16,
                }}>
                  {Object.entries(data.allocation).map(([key, value]) => (
                    value > 0 ? (
                      <div
                        key={key}
                        style={{
                          width: `${value}%`,
                          backgroundColor: ALLOC_COLORS[key] || '#a0a0b0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#0a0a1a',
                          fontFamily: 'JetBrains Mono, monospace',
                          minWidth: value > 5 ? undefined : 0,
                        }}
                      >
                        {value >= 8 ? `${value}%` : ''}
                      </div>
                    ) : null
                  ))}
                </div>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {Object.entries(data.allocation).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        backgroundColor: ALLOC_COLORS[key] || '#a0a0b0',
                      }} />
                      <span style={{ fontSize: 13, color: '#a0a0b0', textTransform: 'capitalize' }}>
                        {key}
                      </span>
                      <span style={{
                        fontSize: 13,
                        color: '#e0e0e0',
                        fontWeight: 600,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {value}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 5. Economic Calendar */}
            {data.upcomingEvents && data.upcomingEvents.length > 0 && (
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginBottom: 14 }}>
                  Economic Calendar
                </h2>
                <div style={{
                  backgroundColor: '#1a1a24',
                  border: '1px solid #2a2a3a',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                        <th style={{ padding: '12px 18px', textAlign: 'left', fontSize: 12, color: '#a0a0b0', fontWeight: 600 }}>
                          Date
                        </th>
                        <th style={{ padding: '12px 18px', textAlign: 'left', fontSize: 12, color: '#a0a0b0', fontWeight: 600 }}>
                          Event
                        </th>
                        <th style={{ padding: '12px 18px', textAlign: 'right', fontSize: 12, color: '#a0a0b0', fontWeight: 600 }}>
                          Importance
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.upcomingEvents.map((evt, i) => {
                        const impColor = evt.importance === 'high' ? '#f87171'
                          : evt.importance === 'medium' ? '#f0c674'
                          : '#6b7280';
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #2a2a3a' }}>
                            <td style={{
                              padding: '12px 18px',
                              fontSize: 13,
                              color: '#a0a0b0',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}>
                              {evt.date}
                            </td>
                            <td style={{ padding: '12px 18px', fontSize: 13, color: '#e0e0e0' }}>
                              {evt.event}
                            </td>
                            <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '3px 10px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                                color: impColor,
                                backgroundColor: `${impColor}18`,
                                border: `1px solid ${impColor}40`,
                              }}>
                                {evt.importance}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 6. AI Interpretation */}
            {data.interpretation && (
              <div style={{
                backgroundColor: '#1a1a24',
                border: '1px solid #2a2a3a',
                borderLeft: '4px solid #8a5cf6',
                borderRadius: 10,
                padding: 24,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#8a5cf6', marginBottom: 10 }}>
                  AI Interpretation
                </div>
                <div style={{ fontSize: 14, color: '#c0c0d0', lineHeight: 1.7 }}>
                  {data.interpretation}
                </div>
              </div>
            )}

            {/* Last Updated */}
            {data.lastUpdated && (
              <div style={{
                textAlign: 'right',
                fontSize: 11,
                color: '#6b7280',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                Last updated: {new Date(data.lastUpdated).toLocaleString()}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
