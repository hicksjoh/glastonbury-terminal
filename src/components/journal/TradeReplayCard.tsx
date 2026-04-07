'use client';

import React, { useState, useCallback } from 'react';
import { Zap } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TradeReplay {
  tradeSummary: string;
  whatHappened: string;
  entryGrade: string;
  exitGrade: string;
  optimalExit: { price: number; time: string; pnl: number };
  moneyLeftOnTable: number;
  edgeAnalysis: string;
  lesson: string;
  patternMatch: string | null;
}

interface TradeReplayCardProps {
  tradeId: string;
  exitPrice: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: '#f0c674',
  B: '#4ade80',
  C: '#facc15',
  D: '#fb923c',
  F: '#f87171',
};

function GradeBadge({ grade, label }: { grade: string; label: string }) {
  const color = GRADE_COLORS[grade] || '#888';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#666', marginBottom: 3, textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 800, color,
        width: 40, height: 40, borderRadius: 8,
        background: `${color}15`, border: `1px solid ${color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {grade}
      </div>
    </div>
  );
}

// ─── Shimmer Skeleton ───────────────────────────────────────────────────────

function ReplaySkeleton() {
  const bar = (w: string) => (
    <div style={{
      width: w, height: 12, borderRadius: 4, marginBottom: 8,
      background: 'linear-gradient(90deg, #1a1a3a 25%, #252545 50%, #1a1a3a 75%)',
      backgroundSize: '200px 100%', animation: 'shimmer 1.5s ease-in-out infinite',
    }} />
  );
  return (
    <div style={{ padding: 16, background: '#0e0e20', borderRadius: 10, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: '#1a1a3a' }} />
        <div style={{ width: 40, height: 40, borderRadius: 8, background: '#1a1a3a' }} />
      </div>
      {bar('90%')}
      {bar('70%')}
      {bar('50%')}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function TradeReplayCardInner({ tradeId, exitPrice }: TradeReplayCardProps) {
  const [replay, setReplay] = useState<TradeReplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const generateReplay = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trade-replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReplay(data.replay);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate replay');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  // Not yet generated — show button
  if (!replay && !loading && !error) {
    return (
      <button
        onClick={generateReplay}
        aria-label="Generate AI post-mortem for this trade"
        style={{
          marginTop: 8, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #f0c674', background: 'transparent',
          color: '#f0c674', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          transition: 'background 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,198,116,0.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Zap size={13} /> AI Post-Mortem
      </button>
    );
  }

  if (loading) return <ReplaySkeleton />;

  if (error) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>
        {error}{' '}
        <button
          onClick={generateReplay}
          style={{ color: '#8a5cf6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!replay) return null;

  const leftOnTable = replay.moneyLeftOnTable;
  const leftLabel = leftOnTable > 0
    ? `$${leftOnTable.toFixed(0)} left on table`
    : `Saved $${Math.abs(leftOnTable).toFixed(0)} vs optimal`;
  const leftColor = leftOnTable > 0 ? '#fb923c' : '#4ade80';

  return (
    <div style={{
      marginTop: 8,
      background: '#0e0e20',
      border: '1px solid #1a1a3a',
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'max-height 300ms ease',
      maxHeight: expanded ? 600 : 44,
    }}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? 'Collapse replay' : 'Expand replay'}
        aria-expanded={expanded}
        style={{
          width: '100%', padding: '10px 14px', border: 'none', background: 'transparent',
          color: '#f0c674', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={12} /> AI Post-Mortem — Entry {replay.entryGrade} | Exit {replay.exitGrade}
        </span>
        <span style={{ fontSize: 11, color: leftColor, fontWeight: 600 }}>{leftLabel}</span>
      </button>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Grades row */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            <GradeBadge grade={replay.entryGrade} label="Entry" />
            <GradeBadge grade={replay.exitGrade} label="Exit" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#666', marginBottom: 3, textTransform: 'uppercase' }}>Optimal Exit</div>
              <div style={{ fontSize: 13, color: '#d0d0e0', fontFamily: "'JetBrains Mono', monospace" }}>
                ${replay.optimalExit.price.toFixed(2)}
                <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>
                  vs yours: ${exitPrice.toFixed(2)}
                </span>
              </div>
              {replay.optimalExit.time && (
                <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{replay.optimalExit.time}</div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.6, marginBottom: 10 }}>
            {replay.tradeSummary}
          </div>

          {/* What Happened */}
          <div style={{ fontSize: 12, color: '#999', lineHeight: 1.5, marginBottom: 10 }}>
            {replay.whatHappened}
          </div>

          {/* Edge Analysis */}
          <div style={{ fontSize: 12, color: '#8888a8', marginBottom: 10 }}>
            <strong style={{ color: '#c084fc' }}>Edge:</strong> {replay.edgeAnalysis}
          </div>

          {/* Lesson — gold callout */}
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            borderLeft: '3px solid #f0c674',
            background: 'rgba(240,198,116,0.06)',
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 10, color: '#f0c674', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>
              Lesson
            </div>
            <div style={{ fontSize: 12, color: '#d0d0e0', lineHeight: 1.5 }}>
              {replay.lesson}
            </div>
          </div>

          {/* Pattern match */}
          {replay.patternMatch && (
            <span style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4,
              background: 'rgba(138,92,246,0.1)', color: '#8a5cf6', fontWeight: 600,
            }}>
              Pattern: {replay.patternMatch}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const TradeReplayCard = React.memo(TradeReplayCardInner);
export default TradeReplayCard;
