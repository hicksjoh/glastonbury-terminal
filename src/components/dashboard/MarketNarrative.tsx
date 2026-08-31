'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, PillBadge, type PillTone } from '@/components/ui';
import { DataAge } from '@/components/ui/DataAge';
import { color, font, size as sz, weight, tracking, space, radius, motion } from '@/lib/design-tokens';

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
  // Widened to 4am–8pm ET to cover pre-market and after-hours, when the
  // narrative can still move. Old 6–18 window missed the pre-market open
  // and left narratives stale for the first few hours of the day.
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const day = et.getDay();
  return day >= 1 && day <= 5 && hour >= 4 && hour < 20;
}

function isStale(ts: string): boolean {
  return Date.now() - new Date(ts).getTime() > 12 * 60 * 60 * 1000;
}

const SENTIMENT_CONFIG: Record<string, { color: string; tone: PillTone; label: string }> = {
  bullish: { color: color.positive,  tone: 'positive', label: 'Bullish' },
  bearish: { color: color.negative,  tone: 'negative', label: 'Bearish' },
  neutral: { color: color.textMuted, tone: 'neutral',  label: 'Neutral' },
};

// ─── Skeleton ───────────────────────────────────────────────────────────────

const SHIMMER_BG = `linear-gradient(90deg, ${color.surfaceHigh} 25%, ${color.border} 50%, ${color.surfaceHigh} 75%)`;

function NarrativeSkeleton() {
  return (
    <Card tone="default" size="lg">
      <div style={{ display: 'flex', alignItems: 'center', gap: space[2], marginBottom: space[4] }}>
        <div style={{ width: 10, height: 10, borderRadius: radius.full, background: color.border }} />
        <div style={{ width: 120, height: 16, borderRadius: radius.chip, background: SHIMMER_BG, backgroundSize: '200px 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      </div>
      {[0.9, 0.7, 0.5].map((w, i) => (
        <div key={i} style={{ width: `${w * 100}%`, height: 14, borderRadius: radius.chip, marginBottom: space[2], background: SHIMMER_BG, backgroundSize: '200px 100%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      ))}
    </Card>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function MarketNarrativeInner() {
  const [data, setData] = useState<NarrativeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNarrative = useCallback(async (opts?: { force?: boolean }) => {
    try {
      setLoading(true);
      setError(null);
      const url = opts?.force ? '/api/narrative?refresh=true' : '/api/narrative';
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
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
      <Card
        tone="default"
        size="lg"
        style={{ color: color.textDim, fontSize: sz.bodyLg.fontSize, textAlign: 'center' }}
      >
        Market narrative unavailable
      </Card>
    );
  }

  if (!data) return null;

  const sentimentCfg = SENTIMENT_CONFIG[data.sentiment] || SENTIMENT_CONFIG.neutral;
  const marketClosed = !isMarketHours();

  return (
    <Card tone="default" size="lg" style={{ position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          {/* Animated radio wave */}
          <div style={{ position: 'relative', width: 12, height: 12 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: radius.full,
              background: sentimentCfg.color,
              animation: isMarketHours() ? 'narrativePulse 2s ease-in-out infinite' : 'none',
              opacity: 0.6,
            }} />
            <div style={{
              position: 'absolute', inset: 2, borderRadius: radius.full,
              background: sentimentCfg.color,
            }} />
          </div>
          <span style={{
            fontSize: sz.label.fontSize,
            fontWeight: weight.semibold,
            color: color.gold,
            textTransform: 'uppercase',
            letterSpacing: tracking.eyebrow,
          }}>
            Market Pulse
          </span>
          {/* Sentiment badge */}
          <PillBadge tone={sentimentCfg.tone} size="sm">
            {sentimentCfg.label}
          </PillBadge>
          {/* Regime badge */}
          <span style={{
            fontSize: sz.micro.fontSize, fontWeight: weight.medium,
            padding: `${space[0.5]}px ${space[2]}px`, borderRadius: radius.chip,
            background: color.glassMd, color: color.textMuted,
            fontFamily: font.mono,
          }}>
            {data.regime.replace(/_/g, ' ')}
          </span>
        </div>
        <button
          onClick={() => fetchNarrative({ force: true })}
          disabled={loading}
          aria-label="Refresh market narrative"
          style={{
            padding: `${space[1]}px ${space[3]}px`, borderRadius: radius.button,
            border: `1px solid ${color.border}`,
            background: 'transparent', color: color.textMuted, fontSize: sz.label.fontSize,
            cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: space[1],
            transition: `color ${motion.duration.fast}ms ${motion.easing.default}, border-color ${motion.duration.fast}ms ${motion.easing.default}`,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = color.gold; e.currentTarget.style.borderColor = color.gold; }}
          onMouseLeave={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.borderColor = color.border; }}
        >
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Market closed / stale note */}
      {marketClosed && !isStale(data.timestamp) && (
        <div style={{ fontSize: sz.label.fontSize, color: color.textDim, marginBottom: space[2], fontStyle: 'italic' }}>
          Markets closed — showing last available narrative
        </div>
      )}
      {isStale(data.timestamp) && (
        <div style={{
          fontSize: sz.label.fontSize, color: color.warning, marginBottom: space[2],
          display: 'flex', alignItems: 'center', gap: space[1],
        }}>
          <span>{'⚠'}</span>
          <span>Narrative is stale. Hit refresh for the latest.</span>
        </div>
      )}

      {/* Narrative text */}
      <p style={{
        fontSize: sz.base.fontSize, lineHeight: `${sz.base.lineHeight}px`, color: color.text,
        margin: 0, marginBottom: space[3],
      }}>
        {data.narrative}
      </p>

      {/* Key Levels */}
      {data.keyLevels.length > 0 && (
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap', marginBottom: space[2] }}>
          {data.keyLevels.map((kl, i) => (
            <span key={i} style={{
              fontSize: sz.label.fontSize, padding: `${space[0.5]}px ${space[2]}px`, borderRadius: radius.chip,
              background: color.goldSubtle, border: `1px solid ${color.gold}30`,
              color: color.gold, fontFamily: font.mono, fontVariantNumeric: 'tabular-nums',
            }}>
              {kl.symbol} ${kl.level.toLocaleString()} — {kl.significance}
            </span>
          ))}
        </div>
      )}

      {/* Timestamp */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space[1] }}>
        {data.cached && (
          <span style={{ fontSize: sz.micro.fontSize, color: color.textDim }}>Cached</span>
        )}
        <DataAge ts={data.timestamp} />
      </div>

      {/* Keyframes injection */}
      <style>{`
        @keyframes narrativePulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </Card>
  );
}

export const MarketNarrative = React.memo(MarketNarrativeInner);
export default MarketNarrative;
