'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { PortfolioCardData } from '@/types/keisha';

// ─── Dynamic Recharts (no SSR) ────────────────────────────────────────────

const AllocationChart = dynamic(() => import('./AllocationDonut'), { ssr: false });

// ─── Currency formatter ────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// ─── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#12122a',
  borderLeft: '4px solid #f0c674',
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: '100%',
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'portfolioCardIn 200ms ease forwards',
};

const containerHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

const headerStyle: React.CSSProperties = {
  color: '#f0c674',
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
};

const totalValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#ffffff',
  fontFamily: "'JetBrains Mono', monospace",
};

const pnlStyle = (positive: boolean): React.CSSProperties => ({
  fontSize: 14,
  fontWeight: 600,
  color: positive ? '#22c55e' : '#ef4444',
  marginTop: 2,
});

const tableContainerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'flex-start',
  gap: 16,
  marginTop: 12,
  width: '100%',
};

const miniTableStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const tableRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '3px 0',
};

const symbolCellStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#ffffff',
  fontFamily: "'JetBrains Mono', monospace",
};

const weightCellStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#8888a8',
  fontFamily: "'JetBrains Mono', monospace",
};

// ─── Keyframe injection ────────────────────────────────────────────────────

const KEYFRAME_ID = 'portfolio-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes portfolioCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${usd.format(Math.abs(value))}`;
}

function formatPnlPct(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `(${prefix}${Math.abs(value).toFixed(1)}%)`;
}

function formatShortPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}$${Math.abs(value).toFixed(0)}`;
}

// ─── PortfolioSnapshotCard ─────────────────────────────────────────────────

interface PortfolioSnapshotCardProps {
  data: PortfolioCardData;
}

function PortfolioSnapshotCard({ data }: PortfolioSnapshotCardProps) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const isPositive = data.dailyPnl >= 0;
  const topThree = data.topPositions.slice(0, 3);
  const showChart = data.allocation.length > 0;

  const mergedContainerStyle: React.CSSProperties = {
    ...containerStyle,
    ...(hovered ? containerHoverStyle : {}),
  };

  return (
    <div
      style={mergedContainerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={headerStyle}>Portfolio Snapshot</div>

      {/* ── Total Value ────────────────────────────────────────── */}
      <div style={totalValueStyle}>{usd.format(data.totalValue)}</div>

      {/* ── Daily P&L ──────────────────────────────────────────── */}
      <div style={pnlStyle(isPositive)}>
        {formatPnl(data.dailyPnl)} {formatPnlPct(data.dailyPnlPct)}
      </div>

      {/* ── Top Positions + Allocation Chart ────────────────────── */}
      {(topThree.length > 0 || showChart) && (
        <div style={tableContainerStyle}>
          {/* ── Mini table ────────────────────────────────────────── */}
          {topThree.length > 0 && (
            <div style={miniTableStyle}>
              {topThree.map((pos) => {
                const posPositive = pos.pnl >= 0;
                return (
                  <div key={pos.symbol} style={tableRowStyle}>
                    <span style={symbolCellStyle}>{pos.symbol}</span>
                    <span style={weightCellStyle}>{pos.weight.toFixed(1)}%</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: posPositive ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {formatShortPnl(pos.pnl)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Allocation donut ─────────────────────────────────── */}
          {showChart && (
            <div style={{ maxHeight: 120, display: 'inline-flex', alignItems: 'center' }}>
              <AllocationChart allocation={data.allocation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Memoized export ───────────────────────────────────────────────────────

export default React.memo(PortfolioSnapshotCard);
