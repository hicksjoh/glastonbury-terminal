'use client';

import React, { useState, useEffect } from 'react';
import { TAX_DISCLAIMER } from '@/lib/tax-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WashSaleCardData {
  isWashSale: boolean;
  ticker: string;
  reason: string;
  conflictingTrade?: {
    date: string;
    action: 'buy' | 'sell';
    quantity: number;
    price: number;
  };
  disallowedLoss: number;
  adjustedCostBasis: number;
  windowStart: string;
  windowEnd: string;
  severity: 'critical' | 'warning' | 'info';
  alertType: 'pre_trade_warning' | 'post_trade_flag' | 'upcoming_window_close';
}

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KF_ID = 'wash-sale-card-kf';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KF_ID)) return;
  const style = document.createElement('style');
  style.id = KF_ID;
  style.textContent = `
    @keyframes washSaleIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Severity Config ────────────────────────────────────────────────────────

const SEV_CONFIG = {
  critical: { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.3)', icon: '\u26A0\uFE0F', label: 'Wash Sale Warning' },
  warning: { color: '#f0c674', bg: 'rgba(240,198,116,0.08)', border: 'rgba(240,198,116,0.3)', icon: '\u26A0\uFE0F', label: 'Wash Sale Risk' },
  info: { color: '#22d3ee', bg: 'rgba(34,211,238,0.08)', border: 'rgba(34,211,238,0.3)', icon: '\u2705', label: 'Window Closing' },
};

// ─── Timeline Bar ───────────────────────────────────────────────────────────

function WashSaleTimeline({ windowStart, windowEnd, conflictDate, sellDate }: {
  windowStart: string;
  windowEnd: string;
  conflictDate?: string;
  sellDate?: string;
}) {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  const range = end - start;
  if (range <= 0) return null;

  const midpoint = 50; // sell date is always center of 61-day window
  const conflictPct = conflictDate
    ? Math.max(0, Math.min(100, ((new Date(conflictDate).getTime() - start) / range) * 100))
    : null;

  return (
    <div style={{ margin: '12px 0 8px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#555', marginBottom: 4 }}>
        <span>{windowStart}</span>
        <span>{windowEnd}</span>
      </div>
      {/* Track */}
      <div style={{
        height: 6, borderRadius: 3, background: '#1a1a3a', position: 'relative', overflow: 'visible',
      }}>
        {/* Danger zone */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          borderRadius: 3, background: 'rgba(248,113,113,0.15)',
        }} />
        {/* Sell date marker */}
        <div style={{
          position: 'absolute', left: `${midpoint}%`, top: -2, width: 2, height: 10,
          background: '#f87171', borderRadius: 1, transform: 'translateX(-1px)',
        }} />
        {/* Conflict marker */}
        {conflictPct !== null && (
          <div style={{
            position: 'absolute', left: `${conflictPct}%`, top: -3, width: 8, height: 12,
            background: '#f0c674', borderRadius: 2, transform: 'translateX(-4px)',
          }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#666', marginTop: 4 }}>
        <span>30 days before</span>
        <span style={{ color: '#f87171' }}>SELL</span>
        <span>30 days after</span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function WashSaleCardInner({ data }: { data: WashSaleCardData }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => { ensureKeyframes(); }, []);

  const cfg = SEV_CONFIG[data.severity];

  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
        marginBottom: 4,
        maxWidth: '100%',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderLeftWidth: 4,
        borderLeftColor: cfg.color,
        animation: 'washSaleIn 200ms ease forwards',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
        ...(hovered ? { transform: 'translateY(-1px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{cfg.icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
          <div style={{ fontSize: 12, color: '#8888a8' }}>{data.ticker}</div>
        </div>
      </div>

      {/* Reason */}
      <div style={{ fontSize: 12, color: '#b0b0c0', lineHeight: 1.6, marginBottom: 8 }}>
        {data.reason}
      </div>

      {/* Key Stats */}
      {data.isWashSale && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          {data.disallowedLoss > 0 && (
            <div style={{
              padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)',
              minWidth: 80,
            }}>
              <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Disallowed Loss</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
                ${data.disallowedLoss.toLocaleString()}
              </div>
            </div>
          )}
          {data.adjustedCostBasis > 0 && (
            <div style={{
              padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)',
              minWidth: 80,
            }}>
              <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Adjusted Basis</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>
                ${data.adjustedCostBasis.toLocaleString()}
              </div>
            </div>
          )}
          {data.conflictingTrade && (
            <div style={{
              padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)',
              minWidth: 80,
            }}>
              <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Conflict Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8e8e8' }}>
                {data.conflictingTrade.date}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <WashSaleTimeline
        windowStart={data.windowStart}
        windowEnd={data.windowEnd}
        conflictDate={data.conflictingTrade?.date}
      />

      {/* Expand / What This Means */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? 'Hide explanation' : 'Show explanation'}
        style={{
          marginTop: 8, padding: '4px 12px', borderRadius: 6,
          border: '1px solid #2a2a3a', background: 'rgba(255,255,255,0.03)',
          color: '#8888a8', fontSize: 11, cursor: 'pointer',
          transition: 'color 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#c4a6ff'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#8888a8'; }}
      >
        {expanded ? 'Hide Details' : 'What This Means'}
      </button>

      {expanded && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(0,0,0,0.2)', fontSize: 12, color: '#999', lineHeight: 1.6,
        }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: '#e8e8e8' }}>Wash Sale Rule (IRS &sect;1091):</strong> If you sell a security at a loss and buy the same or &quot;substantially identical&quot; security within 30 days before or after the sale, the loss is <strong>disallowed</strong> for tax purposes.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            The disallowed loss is added to the cost basis of the replacement shares. You don&apos;t lose the deduction forever &mdash; it&apos;s deferred until you sell the replacement shares (without triggering another wash sale).
          </p>
          <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>
            Section 1256 contracts (futures, index options) and Section 475 mark-to-market elections are exempt from the wash sale rule.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: '#555', marginTop: 10, lineHeight: 1.4, fontStyle: 'italic' }}>
        {TAX_DISCLAIMER}
      </div>
    </div>
  );
}

export default React.memo(WashSaleCardInner);
