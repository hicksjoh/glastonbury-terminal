'use client';

import React, { useState, useEffect } from 'react';
import type { InsiderCardData } from '@/types/keisha';

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#12122a',
  borderLeft: '4px solid #c084fc',
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: 480,
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'insiderCardIn 200ms ease forwards',
};

const containerHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

const KEYFRAME_ID = 'insider-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes insiderCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDollar(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── InsiderCard ────────────────────────────────────────────────────────────

interface InsiderCardProps {
  data: InsiderCardData;
}

function InsiderCard({ data }: InsiderCardProps) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const totalTrades = data.summary.insiderBuys + data.summary.insiderSells + data.summary.congressBuys + data.summary.congressSells;
  const hasSignals = data.signals.length > 0;

  const mergedStyle: React.CSSProperties = {
    ...containerStyle,
    ...(hovered ? containerHoverStyle : {}),
    ...(hasSignals ? { borderLeftColor: '#f0c674' } : {}),
  };

  return (
    <div
      style={mergedStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{hasSignals ? '🔥' : '👔'}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#c084fc' }}>
            {data.symbol} Insider Activity
          </div>
          <div style={{ fontSize: 11, color: '#8888a8' }}>
            {totalTrades} trade{totalTrades !== 1 ? 's' : ''} detected
          </div>
        </div>
      </div>

      {/* ── Summary Stats ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {data.summary.insiderBuys > 0 && (
          <span style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(74,222,128,0.12)', color: '#4ade80', fontWeight: 600,
          }}>
            {data.summary.insiderBuys} Insider Buy{data.summary.insiderBuys > 1 ? 's' : ''}
          </span>
        )}
        {data.summary.insiderSells > 0 && (
          <span style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(248,113,113,0.12)', color: '#f87171', fontWeight: 600,
          }}>
            {data.summary.insiderSells} Insider Sell{data.summary.insiderSells > 1 ? 's' : ''}
          </span>
        )}
        {data.summary.congressBuys > 0 && (
          <span style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(240,198,116,0.12)', color: '#f0c674', fontWeight: 600,
          }}>
            {data.summary.congressBuys} Congress Buy{data.summary.congressBuys > 1 ? 's' : ''}
          </span>
        )}
        {data.summary.congressSells > 0 && (
          <span style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(248,113,113,0.08)', color: '#fb923c', fontWeight: 600,
          }}>
            {data.summary.congressSells} Congress Sell{data.summary.congressSells > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Signals ────────────────────────────────────────────── */}
      {data.signals.length > 0 && (
        <div style={{
          padding: '8px 10px',
          background: 'rgba(240,198,116,0.08)',
          border: '1px solid rgba(240,198,116,0.2)',
          borderRadius: 8,
          marginBottom: 8,
        }}>
          {data.signals.map((sig, i) => (
            <div key={i} style={{ fontSize: 12, color: '#f0c674', lineHeight: 1.5 }}>
              {sig.type === 'cluster_buy' ? '🎯' : '🏛️'} {sig.description}
              <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>
                ({(sig.confidence * 100).toFixed(0)}% confidence)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Top Insider Trades ─────────────────────────────────── */}
      {data.insiderTrades.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {data.insiderTrades.slice(0, expanded ? 5 : 2).map((t, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '5px 0',
              borderBottom: i < (expanded ? 4 : 1) ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <div>
                <span style={{
                  fontSize: 12,
                  color: t.transactionType === 'buy' ? '#4ade80' : '#f87171',
                  fontWeight: 600,
                }}>
                  {t.transactionType === 'buy' ? '↑' : '↓'}
                </span>
                <span style={{ fontSize: 12, color: '#d0d0e0', marginLeft: 6 }}>
                  {t.name}
                </span>
                {t.title && (
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 4 }}>({t.title})</span>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#aaa' }}>
                  {formatDollar(t.totalValue)}
                </span>
                <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>
                  {formatDate(t.date)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Congress Trades (expanded) ─────────────────────────── */}
      {expanded && data.congressTrades.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: '#8888a8',
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
          }}>
            Congressional Trades
          </div>
          {data.congressTrades.slice(0, 3).map((t, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '4px 0',
              fontSize: 12,
            }}>
              <span style={{ color: '#d0d0e0' }}>
                {t.representative}
                {t.party && <span style={{ color: '#666', marginLeft: 4 }}>({t.party})</span>}
              </span>
              <span style={{
                color: t.transactionType === 'buy' ? '#4ade80' : '#f87171',
                fontWeight: 600,
              }}>
                {t.transactionType} {t.amount}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Expand/Collapse ────────────────────────────────────── */}
      {(data.insiderTrades.length > 2 || data.congressTrades.length > 0) && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 8,
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
          {expanded ? 'Show Less' : `Show All (${data.insiderTrades.length + data.congressTrades.length})`}
        </button>
      )}

      {/* ── No Data State ──────────────────────────────────────── */}
      {totalTrades === 0 && (
        <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginTop: 4 }}>
          No insider or congressional trades found for {data.symbol} in this period.
        </div>
      )}
    </div>
  );
}

export default React.memo(InsiderCard);
