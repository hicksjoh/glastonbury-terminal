'use client';

import React, { useEffect } from 'react';

// ─── Keyframe Injection ─────────────────────────────────────────────────────

const KEYFRAME_ID = 'tool-skeleton-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes toolShimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes toolPulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

function ShimmerBar({ width, height = 12, style }: {
  width: string | number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      width,
      height,
      borderRadius: 4,
      background: 'linear-gradient(90deg, rgba(138,92,246,0.06) 25%, rgba(138,92,246,0.12) 50%, rgba(138,92,246,0.06) 75%)',
      backgroundSize: '200% 100%',
      animation: 'toolShimmer 1.5s ease-in-out infinite',
      ...style,
    }} />
  );
}

// ─── ToolLoadingSkeleton ────────────────────────────────────────────────────

export default function ToolLoadingSkeleton() {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  return (
    <div style={{
      marginTop: 12,
      padding: 14,
      background: 'rgba(138,92,246,0.04)',
      border: '1px solid rgba(138,92,246,0.1)',
      borderLeft: '4px solid rgba(138,92,246,0.3)',
      borderRadius: 12,
      maxWidth: 480,
      animation: 'toolPulse 2s ease-in-out infinite',
    }}>
      {/* Header shimmer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'rgba(138,92,246,0.15)',
        }} />
        <ShimmerBar width="40%" height={14} />
        <ShimmerBar width="20%" height={10} style={{ marginLeft: 'auto' }} />
      </div>

      {/* Content shimmer */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <ShimmerBar width="80%" style={{ marginBottom: 8 }} />
          <ShimmerBar width="60%" style={{ marginBottom: 8 }} />
          <ShimmerBar width="45%" />
        </div>
        <div style={{
          width: 60,
          height: 60,
          borderRadius: 8,
          background: 'rgba(138,92,246,0.08)',
        }} />
      </div>

      {/* Status line */}
      <div style={{
        marginTop: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#8a5cf6',
          animation: 'toolPulse 1s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 11, color: '#8a5cf6', fontWeight: 500 }}>
          Fetching live data...
        </span>
      </div>
    </div>
  );
}
