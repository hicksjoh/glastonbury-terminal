'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface KeyLevel {
  symbol: string;
  level: number;
  significance: string;
}

interface NarrativeData {
  narrative: string;
  timestamp: string;
  regime: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  keyLevels: KeyLevel[];
  cached?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isMarketHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const day = et.getDay();
  return day >= 1 && day <= 5 && hour >= 6 && hour <= 18;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

const SENTIMENT_CONFIG: Record<string, { color: string; label: string }> = {
  bullish: { color: '#4ade80', label: 'Bullish' },
  bearish: { color: '#f87171', label: 'Bearish' },
  neutral: { color: '#8888a8', label: 'Neutral' },
};

// ─── Skeleton ───────────────────────────────────────────────────────────────

function NarrativeSkeleton() {
  return (
    <div style={{ padding: 24, background: '#12122a', border: '1px solid #1a1a3a', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2a2a3a' }} />
        <div style={{ width: 120, height: 16, borderRadius: 4, background: 'linear-gradient(90deg, #1a1a3a 25%, #252545 50%, #1a1a3a 75%)', backgroundSize: '200px 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      </div>
      {[0.9, 0.7, 0.5].map((w, i) => (
        <div key={i} style={{ width: `${w * 100}%`, height: 14, borderRadius: 4, marginBottom: 8, background: 'linear-gradient(90deg, #1a1a3a 25%, #252545 50%, #1a1a3a 75%)', backgroundSize: '200px 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function MarketNarrativeInner() {
  const [data, setData] = useState<NarrativeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNarrative = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/narrative', { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`);
      }
      const json = await res.json() as NarrativeData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load narrative');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNarrative();

    // Auto-refresh every 5 minutes during market hours
    refreshTimer.current = setInterval(() => {
      if (isMarketHours()) fetchNarrative();
    }, 5 * 60 * 1000);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchNarrative]);

  if (loading && !data) return <NarrativeSkeleton />;

  if (error && !data) {
    return (
      <div style={{
        padding: 20, background: '#12122a', border: '1px solid #1a1a3a', borderRadius: 16,
        color: '#666', fontSize: 13, textAlign: 'center',
      }}>
        Market narrative unavailable
      </div>
    );
  }

  if (!data) return null;

  const sentimentCfg = SENTIMENT_CONFIG[data.sentiment] || SENTIMENT_CONFIG.neutral;
  const marketClosed = !isMarketHours();

  return (
    <div style={{
      padding: 24,
      background: '#12122a',
      border: '1px solid #1a1a3a',
      borderRadius: 16,
      position: 'relative',
      transition: 'transform 150ms ease, box-shadow 150ms ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Animated radio wave */}
          <div style={{ position: 'relative', width: 12, height: 12 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: sentimentCfg.color,
              animation: isMarketHours() ? 'narrativePulse 2s ease-in-out infinite' : 'none',
              opacity: 0.6,
            }} />
            <div style={{
              position: 'absolute', inset: 2, borderRadius: '50%',
              background: sentimentCfg.color,
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Market Pulse
          </span>
          {/* Sentiment badge */}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: `${sentimentCfg.color}18`,
            color: sentimentCfg.color,
          }}>
            {sentimentCfg.label}
          </span>
          {/* Regime badge */}
          <span style={{
            fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
            background: 'rgba(138,92,246,0.1)', color: '#8a5cf6',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {data.regime.replace(/_/g, ' ')}
          </span>
        </div>
        <button
          onClick={fetchNarrative}
          disabled={loading}
          aria-label="Refresh market narrative"
          style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid #333',
            background: 'transparent', color: '#888', fontSize: 11,
            cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f0c674'; e.currentTarget.style.borderColor = '#f0c674'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#333'; }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Market closed note */}
      {marketClosed && (
        <div style={{ fontSize: 11, color: '#555', marginBottom: 8, fontStyle: 'italic' }}>
          Markets closed — showing last available narrative
        </div>
      )}

      {/* Narrative text */}
      <p style={{
        fontSize: 15, lineHeight: 1.7, color: '#d4d4d4', margin: 0, marginBottom: 12,
      }}>
        {data.narrative}
      </p>

      {/* Key Levels */}
      {data.keyLevels.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {data.keyLevels.map((kl, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6,
              background: 'rgba(240,198,116,0.08)', border: '1px solid rgba(240,198,116,0.15)',
              color: '#f0c674', fontFamily: "'JetBrains Mono', monospace",
            }}>
              {kl.symbol} ${kl.level.toLocaleString()} — {kl.significance}
            </span>
          ))}
        </div>
      )}

      {/* Timestamp */}
      <div style={{ fontSize: 10, color: '#555', textAlign: 'right' }}>
        {timeAgo(data.timestamp)}
        {data.cached && ' (cached)'}
      </div>

      {/* Keyframes injection */}
      <style>{`
        @keyframes narrativePulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export const MarketNarrative = React.memo(MarketNarrativeInner);
export default MarketNarrative;
