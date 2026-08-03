'use client';

import React from 'react';
import { color } from '@/lib/design-tokens';

// Three gold dots pulsing — the "Claude is thinking" primitive.
// Replaces the ad-hoc dot arrays in BriefingCard, VoiceMic, Keisha stream, etc.

export interface StreamingIndicatorProps {
  variant?: 'dots' | 'cursor';
  label?: string;
}

export function StreamingIndicator({ variant = 'dots', label }: StreamingIndicatorProps) {
  if (variant === 'cursor') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 8,
          height: 14,
          background: color.gold,
          marginLeft: 2,
          verticalAlign: 'middle',
          animation: 'blink 1s steps(1) infinite',
        }}
      />
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Streaming'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color.gold,
            animation: `streamDot 1.4s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
      {label && <span style={{ fontSize: 11, color: color.textMuted, marginLeft: 6 }}>{label}</span>}
    </span>
  );
}
