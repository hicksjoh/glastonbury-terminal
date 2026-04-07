'use client';

import React, { useState, useEffect } from 'react';
import type { GEXCardData } from '@/types/keisha';

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerBase: React.CSSProperties = {
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: 480,
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'gexCardIn 200ms ease forwards',
};

const containerHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

const levelRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  fontSize: 12,
};

const labelStyle: React.CSSProperties = {
  color: '#8888a8',
  fontWeight: 500,
};

const valueStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  color: '#ffffff',
};

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KEYFRAME_ID = 'gex-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes gexCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatGEX(value: number): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

// ─── GEXCard ────────────────────────────────────────────────────────────────

interface GEXCardProps {
  data: GEXCardData;
}

function GEXCard({ data }: GEXCardProps) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const isPositive = data.regime === 'positive';
  const regimeColor = isPositive ? '#4ade80' : '#f87171';
  const regimeLabel = isPositive ? 'POSITIVE GAMMA' : 'NEGATIVE GAMMA';
  const regimeIcon = isPositive ? '🛡️' : '⚡';
  const borderColor = isPositive ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)';
  const bgColor = isPositive ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)';

  const containerStyle: React.CSSProperties = {
    ...containerBase,
    background: bgColor,
    borderLeft: `4px solid ${regimeColor}`,
    border: `1px solid ${borderColor}`,
    borderLeftWidth: 4,
    ...(hovered ? containerHoverStyle : {}),
  };

  return (
    <div
      style={containerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{regimeIcon}</span>
        <div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: regimeColor,
            letterSpacing: 0.5,
          }}>
            {regimeLabel}
          </div>
          <div style={{ fontSize: 12, color: '#8888a8' }}>
            {data.symbol} GEX Analysis
            {data.dataSource === 'synthetic' && (
              <span style={{ fontSize: 9, color: '#555', marginLeft: 6 }}>synthetic</span>
            )}
          </div>
        </div>
        <div style={{
          marginLeft: 'auto',
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: regimeColor,
        }}>
          {formatGEX(data.netGEX)}
        </div>
      </div>

      {/* ── Key Levels Grid ────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '4px 16px',
        padding: '10px 12px',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 8,
      }}>
        <div style={levelRowStyle}>
          <span style={labelStyle}>Put Wall</span>
          <span style={{ ...valueStyle, color: '#f87171' }}>${data.levels.putWall}</span>
        </div>
        <div style={levelRowStyle}>
          <span style={labelStyle}>Call Wall</span>
          <span style={{ ...valueStyle, color: '#4ade80' }}>${data.levels.callWall}</span>
        </div>
        <div style={levelRowStyle}>
          <span style={labelStyle}>Gamma Flip</span>
          <span style={{ ...valueStyle, color: '#f0c674' }}>${data.levels.gammaFlip}</span>
        </div>
        <div style={levelRowStyle}>
          <span style={labelStyle}>HVL</span>
          <span style={{ ...valueStyle, color: '#c4a6ff' }}>${data.levels.hvl}</span>
        </div>
      </div>

      {/* ── Spot Price Context ─────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 8,
        fontSize: 12,
        color: '#8888a8',
      }}>
        <span>Spot: <span style={{ ...valueStyle, fontSize: 12 }}>${data.spotPrice.toFixed(2)}</span></span>
        {data.levels.pinStrikes.length > 0 && (
          <span>Pin: <span style={{ ...valueStyle, fontSize: 12 }}>${data.levels.pinStrikes[0]}</span></span>
        )}
      </div>

      {/* ── Expand/Collapse ────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          marginTop: 10,
          padding: '4px 12px',
          borderRadius: 6,
          border: '1px solid #2a2a3a',
          background: 'rgba(255,255,255,0.03)',
          color: '#8888a8',
          fontSize: 11,
          cursor: 'pointer',
          transition: 'color 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#c4a6ff'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#8888a8'; }}
      >
        {expanded ? 'Hide Impact' : 'Show Impact'}
      </button>

      {/* ── Impact Detail ──────────────────────────────────────── */}
      {expanded && (
        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
          fontSize: 12,
          color: '#b0b0c0',
          lineHeight: 1.6,
        }}>
          {data.impact}
        </div>
      )}
    </div>
  );
}

// ─── Memoized Export ────────────────────────────────────────────────────────

export default React.memo(GEXCard);
