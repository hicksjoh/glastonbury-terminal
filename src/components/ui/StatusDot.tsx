'use client';

import React from 'react';
import { color } from '@/lib/design-tokens';

// Round status dot — connection health, live/idle, streaming presence.
// Replaces ~100+ inline `<div style={{ width: 6, height: 6, borderRadius: '50%' }}>`.

export type StatusTone = 'connected' | 'error' | 'checking' | 'idle' | 'live';

export interface StatusDotProps {
  status: StatusTone;
  size?: number;
  label?: string;   // when set, renders as a labeled row
}

const TONE_COLOR: Record<StatusTone, string> = {
  connected: color.positive,
  error:     color.negative,
  checking:  color.warning,
  idle:      color.textDim,
  live:      color.gold,
};

export function StatusDot({ status, size = 6, label }: StatusDotProps) {
  const dot = (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: TONE_COLOR[status],
        boxShadow: status === 'live' || status === 'connected'
          ? `0 0 0 3px ${TONE_COLOR[status]}20`
          : 'none',
        animation: status === 'checking' || status === 'live' ? 'pulse 1.6s ease-in-out infinite' : 'none',
        flexShrink: 0,
      }}
    />
  );
  if (!label) return dot;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {dot}
      <span style={{ fontSize: 12, color: color.textMuted }}>{label}</span>
    </span>
  );
}
