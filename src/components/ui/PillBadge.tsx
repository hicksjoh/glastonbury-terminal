'use client';

import React from 'react';
import { color, radius, size as sz, weight, tracking, space } from '@/lib/design-tokens';

// The one pill. Replaces the 300+ inline `padding: '3px 10px', borderRadius: 6, ...`
// chips scattered across the app.

export type PillTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'gold' | 'danger';
export type PillSize = 'sm' | 'md';

export interface PillBadgeProps {
  tone?: PillTone;
  size?: PillSize;
  uppercase?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

const TONE: Record<PillTone, { fg: string; bg: string; border: string }> = {
  neutral:  { fg: color.textMuted, bg: color.glassMd,       border: color.border },
  positive: { fg: color.positive,  bg: color.positiveSubtle, border: `${color.positive}30` },
  negative: { fg: color.negative,  bg: color.negativeSubtle, border: `${color.negative}30` },
  warning:  { fg: color.warning,   bg: color.warningSubtle,  border: `${color.warning}30` },
  info:     { fg: color.info,      bg: color.infoSubtle,     border: `${color.info}30` },
  gold:     { fg: color.gold,      bg: color.goldSubtle,     border: `${color.gold}30` },
  danger:   { fg: color.danger,    bg: `${color.danger}20`,  border: `${color.danger}40` },
};

const PADDING: Record<PillSize, string> = {
  sm: '2px 8px',
  md: '4px 10px',
};

export function PillBadge({ tone = 'neutral', size = 'sm', uppercase, children, onClick }: PillBadgeProps) {
  const t = TONE[tone];
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[1],
        padding: PADDING[size],
        borderRadius: radius.chip,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.fg,
        fontSize: sz.label.fontSize,
        fontWeight: weight.semibold,
        letterSpacing: uppercase ? tracking.loose : tracking.normal,
        textTransform: uppercase ? 'uppercase' : 'none',
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
