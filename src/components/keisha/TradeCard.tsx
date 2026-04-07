'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { TradeCardData } from '@/types/keisha';
import SparklineChart from '@/components/SparklineChart';

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#12122a',
  borderLeft: '4px solid #8a5cf6',
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: 480,
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'tradeCardIn 200ms ease forwards',
};

const containerHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const symbolStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 16,
  color: '#ffffff',
};

const priceStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 16,
  color: '#ffffff',
};

const badgeBase: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 6,
  whiteSpace: 'nowrap',
};

const sparklineRowStyle: React.CSSProperties = {
  marginTop: 10,
};

const positionRowStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#8888a8',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 10,
  flexWrap: 'wrap',
};

const buttonBase: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid #2a2a3a',
  background: 'rgba(255,255,255,0.03)',
  color: '#8888a8',
  fontSize: 11,
  cursor: 'pointer',
  transition: 'border-color 150ms ease, color 150ms ease',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDollar(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
}

function formatPct(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function changeBadgeStyle(positive: boolean): React.CSSProperties {
  return {
    ...badgeBase,
    background: positive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
    color: positive ? '#22c55e' : '#ef4444',
  };
}

// ─── Keyframe injection ─────────────────────────────────────────────────────

const KEYFRAME_ID = 'trade-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes tradeCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── ActionButton (internal) ────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  ariaLabel: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

function ActionButton({ label, ariaLabel, onClick }: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    ...buttonBase,
    ...(hovered ? { borderColor: '#8a5cf6', color: '#c4a6ff' } : {}),
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {label}
    </button>
  );
}

// ─── TradeCard ──────────────────────────────────────────────────────────────

interface TradeCardProps {
  data: TradeCardData;
}

function TradeCard({ data }: TradeCardProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const watchlistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Clean up watchlist timer on unmount
  useEffect(() => {
    return () => {
      if (watchlistTimerRef.current) {
        clearTimeout(watchlistTimerRef.current);
      }
    };
  }, []);

  const isPositive = data.change >= 0;
  const sparklineColor = isPositive ? '#22c55e' : '#ef4444';

  const handleSetAlert = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push(`/alerts?symbol=${data.symbol}`);
    },
    [router, data.symbol],
  );

  const handleWatchlistAdd = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      try {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: data.symbol, action: 'add' }),
        });
      } catch {
        // Silently fail -- UI still flashes confirmation
      }
      setWatchlistAdded(true);
      watchlistTimerRef.current = setTimeout(() => {
        setWatchlistAdded(false);
      }, 1500);
    },
    [data.symbol],
  );

  const handleChart = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push(`/stock/${data.symbol}`);
    },
    [router, data.symbol],
  );

  const handleTrade = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push(`/trading?symbol=${data.symbol}`);
    },
    [router, data.symbol],
  );

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
      {/* ── Header Row ─────────────────────────────────────────── */}
      <div style={headerRowStyle}>
        <span style={symbolStyle}>{data.symbol}</span>
        <span style={priceStyle}>${data.currentPrice.toFixed(2)}</span>
        <span style={changeBadgeStyle(isPositive)}>
          {formatDollar(data.change)} ({formatPct(data.changePct)})
        </span>
      </div>

      {/* ── Sparkline Row ──────────────────────────────────────── */}
      {data.sparklineData && data.sparklineData.length > 1 && (
        <div style={sparklineRowStyle}>
          <SparklineChart
            data={data.sparklineData}
            width={200}
            height={32}
            color={sparklineColor}
          />
        </div>
      )}

      {/* ── Position Row ───────────────────────────────────────── */}
      {data.positionQty != null && (
        <div style={positionRowStyle}>
          <span>Position: {data.positionQty} shares</span>
          {data.positionPnl != null && data.positionPnlPct != null && (
            <span
              style={{
                marginLeft: 8,
                color: data.positionPnl >= 0 ? '#22c55e' : '#ef4444',
                fontWeight: 600,
              }}
            >
              {formatDollar(data.positionPnl)} ({formatPct(data.positionPnlPct)})
            </span>
          )}
        </div>
      )}

      {/* ── Action Buttons Row ─────────────────────────────────── */}
      <div style={buttonRowStyle}>
        <ActionButton
          label="Set Alert"
          ariaLabel={`Set price alert for ${data.symbol}`}
          onClick={handleSetAlert}
        />
        {watchlistAdded ? (
          <span
            style={{
              fontSize: 11,
              color: '#22c55e',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 10px',
            }}
          >
            Added!
          </span>
        ) : (
          <ActionButton
            label="Watchlist +"
            ariaLabel={`Add ${data.symbol} to watchlist`}
            onClick={handleWatchlistAdd}
          />
        )}
        <ActionButton
          label="Chart"
          ariaLabel={`View chart for ${data.symbol}`}
          onClick={handleChart}
        />
        <ActionButton
          label="Trade"
          ariaLabel={`Trade ${data.symbol}`}
          onClick={handleTrade}
        />
      </div>
    </div>
  );
}

// ─── Memoized export with custom comparator ─────────────────────────────────

export default React.memo(TradeCard, (prev, next) => {
  return (
    prev.data.symbol === next.data.symbol &&
    prev.data.currentPrice === next.data.currentPrice
  );
});
