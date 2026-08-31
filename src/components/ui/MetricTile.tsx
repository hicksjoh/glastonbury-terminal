'use client';

import React from 'react';
import { Card } from './Card';
import { color, font, size as sz, weight, tracking, space } from '@/lib/design-tokens';

// KPI tile — the atomic unit of the dashboard strip.
// One value, one label, optional caption + delta + on-click.

export type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'gold';

export interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: MetricTone;
  onClick?: () => void;
}

const VALUE_COLOR: Record<MetricTone, string> = {
  neutral:  color.text,
  positive: color.positive,
  negative: color.negative,
  warning:  color.warning,
  gold:     color.gold,
};

export function MetricTile({ label, value, caption, tone = 'neutral', onClick }: MetricTileProps) {
  return (
    <Card size="md" onClick={onClick} interactive={!!onClick}>
      <div
        style={{
          fontSize: sz.label.fontSize,
          fontWeight: weight.semibold,
          color: color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: tracking.eyebrow,
          marginBottom: space[2],
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 20,
          lineHeight: '24px',
          fontWeight: weight.bold,
          color: VALUE_COLOR[tone],
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {caption != null && (
        <div style={{ fontSize: sz.label.fontSize, color: color.textDim, marginTop: space[1] }}>
          {caption}
        </div>
      )}
    </Card>
  );
}
