'use client';

import React, { useState, useEffect } from 'react';
import type { GuardCardData } from '@/types/keisha';

// ─── Verdict Config ─────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  CLEAR: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.3)', label: 'CLEAR TO TRADE' },
  CAUTION: { color: '#f0c674', bg: 'rgba(240,198,116,0.08)', border: 'rgba(240,198,116,0.3)', label: 'PROCEED WITH CAUTION' },
  STOP: { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.3)', label: 'REVIEW REQUIRED' },
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerBase: React.CSSProperties = {
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: '100%',
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'guardCardIn 200ms ease forwards',
};

const sectionStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  background: 'rgba(0,0,0,0.2)',
  borderRadius: 8,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#8888a8',
  marginBottom: 6,
};

const alertItemStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  marginBottom: 6,
  fontSize: 12,
  lineHeight: 1.5,
};

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KEYFRAME_ID = 'guard-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes guardCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── GuardCard ──────────────────────────────────────────────────────────────

interface GuardCardProps {
  data: GuardCardData;
}

function GuardCard({ data }: GuardCardProps) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const cfg = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.CAUTION;

  const containerStyle: React.CSSProperties = {
    ...containerBase,
    background: cfg.bg,
    borderLeft: `4px solid ${cfg.color}`,
    border: `1px solid ${cfg.border}`,
    borderLeftWidth: 4,
    ...(hovered ? { transform: 'translateY(-1px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' } : {}),
  };

  return (
    <div
      style={containerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Verdict Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>
          {data.verdict === 'CLEAR' ? '🛡️' : data.verdict === 'CAUTION' ? '⚠️' : '🚫'}
        </span>
        <div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: cfg.color,
            letterSpacing: 0.5,
          }}>
            {cfg.label}
          </div>
          <div style={{ fontSize: 12, color: '#8888a8' }}>
            {data.side.toUpperCase()} {data.symbol}
          </div>
        </div>
      </div>

      {/* ── Verdict Message ────────────────────────────────────── */}
      <div style={{ fontSize: 12, color: '#b0b0c0', marginTop: 4, lineHeight: 1.5 }}>
        {data.verdictMessage}
      </div>

      {/* ── Quick Stats Row ────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        {/* Kelly Sizing */}
        <div style={{
          flex: 1,
          minWidth: 100,
          padding: '8px 10px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Position Size</div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: data.kellySizing.verdict === 'optimal' ? '#4ade80'
              : data.kellySizing.verdict === 'way_oversized' ? '#f87171'
              : '#f0c674',
          }}>
            {data.kellySizing.proposedPct}%
          </div>
          <div style={{ fontSize: 10, color: '#666' }}>
            Half-Kelly: {data.kellySizing.halfKellyPct}%
          </div>
        </div>

        {/* Regime */}
        <div style={{
          flex: 1,
          minWidth: 100,
          padding: '8px 10px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 10, color: '#8888a8', fontWeight: 600, textTransform: 'uppercase' }}>Market Regime</div>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: data.regime.label.includes('BULL') ? '#4ade80' : '#f87171',
          }}>
            {data.regime.label}
          </div>
          <div style={{ fontSize: 10, color: '#666' }}>
            Multiplier: {data.regime.regimeMultiplier}x
          </div>
        </div>
      </div>

      {/* ── Behavioral Alerts ──────────────────────────────────── */}
      {data.behavioralAlerts.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Behavioral Alerts ({data.behavioralAlerts.length})</div>
          {data.behavioralAlerts.map((alert, i) => (
            <div
              key={i}
              style={{
                ...alertItemStyle,
                background: alert.severity === 'critical'
                  ? 'rgba(248,113,113,0.1)'
                  : 'rgba(240,198,116,0.1)',
                border: `1px solid ${alert.severity === 'critical' ? 'rgba(248,113,113,0.2)' : 'rgba(240,198,116,0.2)'}`,
              }}
            >
              <div style={{
                fontWeight: 600,
                color: alert.severity === 'critical' ? '#f87171' : '#f0c674',
                marginBottom: 4,
              }}>
                {alert.title}
              </div>
              <div style={{ color: '#b0b0c0' }}>{alert.message}</div>
              {expanded && (
                <div style={{ color: '#8a5cf6', marginTop: 6, fontStyle: 'italic' }}>
                  {alert.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Concentration Warning ──────────────────────────────── */}
      {data.concentration?.warning && (
        <div style={{
          ...sectionStyle,
          background: 'rgba(240,198,116,0.06)',
          border: '1px solid rgba(240,198,116,0.15)',
        }}>
          <div style={{ fontSize: 12, color: '#f0c674' }}>
            {data.concentration.warning}
          </div>
        </div>
      )}

      {/* ── Expand/Collapse ────────────────────────────────────── */}
      {(data.behavioralAlerts.length > 0 || data.kellySizing.verdictMessage) && (
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
          {expanded ? 'Show Less' : 'Show Details'}
        </button>
      )}

      {/* ── Expanded Details ───────────────────────────────────── */}
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Sizing Details */}
          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>Kelly Sizing</div>
            <div style={{ fontSize: 12, color: '#b0b0c0', lineHeight: 1.6 }}>
              {data.kellySizing.verdictMessage}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Proposed: {data.kellySizing.proposedShares} shares ({data.kellySizing.proposedPct}%) |
              Regime-adjusted: {data.kellySizing.regimeAdjustedShares} shares
            </div>
          </div>

          {/* Regime Advice */}
          <div style={sectionStyle}>
            <div style={sectionLabelStyle}>Regime Advice</div>
            <div style={{ fontSize: 12, color: '#b0b0c0', lineHeight: 1.5 }}>
              {data.regime.advice}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Memoized Export ────────────────────────────────────────────────────────

export default React.memo(GuardCard);
