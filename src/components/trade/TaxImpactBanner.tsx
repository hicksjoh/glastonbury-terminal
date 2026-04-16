'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
//  TaxImpactBanner — Compact pre-trade tax analysis
//  Shows holding period, gain type, estimated tax, lot method, wash sale risk
//  Collapsible: default collapsed, auto-expands on warnings
// ═══════════════════════════════════════════════════════════════════════════

interface TaxImpactData {
  symbol: string;
  side: string;
  qty: number;
  currentPrice: number;
  avgEntry: number;
  estimatedGain: number;
  holdingPeriod: {
    type: string;
    daysHeld: number;
    daysUntilLongTerm: number;
  } | null;
  taxEstimate: {
    tax: number;
    rate: number;
    isLongTerm: boolean;
  };
  longTermNudge: {
    daysToWait: number;
    potentialSavings: number;
  } | null;
  washSale: {
    triggered: boolean;
    severity: string;
    message: string;
    conflictingTrade: { date: string; action: string; quantity: number; price: number } | null;
    disallowedLoss: number;
  } | null;
  lotComparison: {
    bestMethod: string;
    maxSavings: number;
    methods: Record<string, { totalGain: number; estimatedTax: number; shortTermGain: number; longTermGain: number }>;
  } | null;
}

interface TaxImpactBannerProps {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  compact?: boolean; // even more compact for Keisha chat banner
}

// ── Keyframe injection ──────────────────────────────────────────────────

let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes taxBannerSlide {
      from { opacity: 0; max-height: 0; margin-bottom: 0; }
      to { opacity: 1; max-height: 400px; margin-bottom: 12px; }
    }
    @keyframes taxBannerPulse {
      0%, 100% { border-color: rgba(248, 113, 113, 0.3); }
      50% { border-color: rgba(248, 113, 113, 0.7); }
    }
  `;
  document.head.appendChild(style);
  keyframesInjected = true;
}

// ── Component ───────────────────────────────────────────────────────────

function TaxImpactBannerInner({ symbol, side, qty, compact = false }: TaxImpactBannerProps) {
  const [data, setData] = useState<TaxImpactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);

  useEffect(() => { ensureKeyframes(); }, []);

  const fetchImpact = useCallback(async () => {
    if (!symbol || qty <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        symbol,
        side,
        qty: String(qty),
      });
      const res = await fetch(`/api/tax/impact?${params}`);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        // Auto-expand if there are warnings
        const hasWarnings = json.data.washSale?.triggered ||
          json.data.longTermNudge !== null;
        if (hasWarnings && !autoExpanded) {
          setExpanded(true);
          setAutoExpanded(true);
        }
      } else {
        setError(json.error || 'Failed to fetch');
      }
    } catch {
      setError('Tax impact unavailable');
    } finally {
      setLoading(false);
    }
  }, [symbol, side, qty, autoExpanded]);

  useEffect(() => {
    fetchImpact();
  }, [fetchImpact]);

  // Don't render for buys with no warnings (less useful)
  if (!loading && !error && data && side === 'buy' && !data.washSale?.triggered) {
    return null;
  }

  if (loading) {
    return (
      <div style={{
        background: 'rgba(138, 92, 246, 0.06)',
        border: '1px solid rgba(138, 92, 246, 0.15)',
        borderRadius: 8,
        padding: compact ? '8px 12px' : '10px 14px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          border: '2px solid rgba(138, 92, 246, 0.3)',
          borderTopColor: '#8a5cf6',
          animation: 'spin 1s linear infinite',
        }} />
        <span style={{ fontSize: 12, color: '#8a8aad' }}>Analyzing tax impact...</span>
      </div>
    );
  }

  if (error || !data) return null;

  const hasWashSale = data.washSale?.triggered;
  const hasLTNudge = data.longTermNudge !== null;
  const hasLotSavings = data.lotComparison && data.lotComparison.maxSavings > 0;
  const hasWarnings = hasWashSale || hasLTNudge;

  const borderColor = hasWashSale
    ? 'rgba(248, 113, 113, 0.3)'
    : hasLTNudge
      ? 'rgba(240, 198, 116, 0.3)'
      : 'rgba(138, 92, 246, 0.2)';

  const animationName = hasWashSale ? 'taxBannerSlide, taxBannerPulse' : 'taxBannerSlide';
  const animationDuration = hasWashSale ? '0.3s ease, 2s ease infinite' : '0.3s ease';

  return (
    <div style={{
      background: hasWashSale
        ? 'rgba(248, 113, 113, 0.06)'
        : 'rgba(138, 92, 246, 0.06)',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      padding: compact ? '8px 12px' : '10px 14px',
      marginBottom: 12,
      animation: animationName,
      animationDuration: animationDuration,
      overflow: 'hidden',
    }}>
      {/* Header — always visible */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Tax impact details for ${symbol}. ${expanded ? 'Click to collapse' : 'Click to expand'}`}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>📊</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c8c8e0', letterSpacing: '0.03em' }}>
            Tax Impact
          </span>
          {hasWashSale && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#f87171',
              background: 'rgba(248, 113, 113, 0.15)',
              padding: '1px 6px', borderRadius: 4,
            }}>
              WASH SALE
            </span>
          )}
          {hasLTNudge && !hasWashSale && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#f0c674',
              background: 'rgba(240, 198, 116, 0.15)',
              padding: '1px 6px', borderRadius: 4,
            }}>
              NEAR LT
            </span>
          )}
        </div>

        {/* Collapsed summary */}
        {!expanded && data.holdingPeriod && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#8a8aad' }}>
            <span>{data.holdingPeriod.type === 'long_term' ? 'LT' : 'ST'} · {data.holdingPeriod.daysHeld}d</span>
            {data.estimatedGain !== 0 && (
              <span style={{ color: data.estimatedGain >= 0 ? '#4ade80' : '#f87171' }}>
                {data.estimatedGain >= 0 ? '+' : ''}{formatCurrency(data.estimatedGain)}
              </span>
            )}
            {data.taxEstimate.tax > 0 && (
              <span>~{formatCurrency(data.taxEstimate.tax)} tax</span>
            )}
            <span style={{ fontSize: 10, color: '#555' }}>▼</span>
          </div>
        )}
        {expanded && (
          <span style={{ fontSize: 10, color: '#555' }}>▲</span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Holding Period */}
          {data.holdingPeriod && (
            <DetailRow
              icon="⏱"
              label="Holding period"
              value={`${data.holdingPeriod.daysHeld} days (${data.holdingPeriod.type === 'long_term' ? 'LONG-TERM' : 'SHORT-TERM'})`}
              valueColor={data.holdingPeriod.type === 'long_term' ? '#4ade80' : '#f0c674'}
              sub={data.holdingPeriod.daysUntilLongTerm > 0
                ? `${data.holdingPeriod.daysUntilLongTerm} days until long-term`
                : undefined}
            />
          )}

          {/* Estimated Gain */}
          {data.estimatedGain !== 0 && (
            <DetailRow
              icon={data.estimatedGain >= 0 ? '📈' : '📉'}
              label="Estimated gain"
              value={`${data.estimatedGain >= 0 ? '+' : ''}${formatCurrency(data.estimatedGain)} → taxed at ${(data.taxEstimate.rate * 100).toFixed(0)}% = ~${formatCurrency(data.taxEstimate.tax)}`}
              valueColor={data.estimatedGain >= 0 ? '#4ade80' : '#f87171'}
            />
          )}

          {/* Lot Method */}
          {hasLotSavings && data.lotComparison && (
            <DetailRow
              icon="🧮"
              label="Lot method"
              value={`${data.lotComparison.bestMethod.toUpperCase()} saves ${formatCurrency(data.lotComparison.maxSavings)} vs worst method`}
              valueColor="#8a5cf6"
            />
          )}

          {/* Wash Sale Warning */}
          {hasWashSale && data.washSale && (
            <div style={{
              background: 'rgba(248, 113, 113, 0.08)',
              border: '1px solid rgba(248, 113, 113, 0.2)',
              borderRadius: 6,
              padding: '8px 10px',
              marginTop: 2,
            }}>
              <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, marginBottom: 2 }}>
                ⚠️ Wash Sale Risk
              </div>
              <div style={{ fontSize: 11, color: '#e8a0a0', lineHeight: 1.4 }}>
                {data.washSale.message}
              </div>
            </div>
          )}

          {/* Long-Term Nudge */}
          {hasLTNudge && data.longTermNudge && (
            <div style={{
              background: 'rgba(240, 198, 116, 0.08)',
              border: '1px solid rgba(240, 198, 116, 0.2)',
              borderRadius: 6,
              padding: '8px 10px',
              marginTop: 2,
            }}>
              <div style={{ fontSize: 11, color: '#f0c674', fontWeight: 700, marginBottom: 2 }}>
                💡 Long-Term Opportunity
              </div>
              <div style={{ fontSize: 11, color: '#d4c094', lineHeight: 1.4 }}>
                This position converts to LONG-TERM in {data.longTermNudge.daysToWait} days.
                {data.longTermNudge.potentialSavings > 0 && (
                  <> Waiting could save you <strong style={{ color: '#4ade80' }}>{formatCurrency(data.longTermNudge.potentialSavings)}</strong> in taxes.</>
                )}
              </div>
            </div>
          )}

          {/* No warnings */}
          {!hasWashSale && side === 'sell' && (
            <DetailRow
              icon="✅"
              label="Wash sale"
              value="No wash sale risk detected"
              valueColor="#4ade80"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Helper Components ───────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  valueColor = '#c8c8e0',
  sub,
}: {
  icon: string;
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <span style={{ fontSize: 11, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, lineHeight: 1.4 }}>
          <span style={{ color: '#6b6b80' }}>{label}: </span>
          <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
        </div>
        {sub && (
          <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Export ───────────────────────────────────────────────────────────────

const TaxImpactBanner = React.memo(TaxImpactBannerInner);
export default TaxImpactBanner;
