'use client';

import React, { forwardRef } from 'react';
import { color, radius, elevation, motion } from '@/lib/design-tokens';

// The one card component. Every panel, card, tile in the terminal wraps this.
// See docs/DESIGN-SYSTEM.md for when to use each `elevation`.

export type CardTone = 'default' | 'aiAccent' | 'inset' | 'positive' | 'negative';
export type CardSize = 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  size?: CardSize;
  interactive?: boolean;
  as?: 'div' | 'article' | 'section' | 'button' | 'a';
  href?: string;
}

const PADDING: Record<CardSize, string> = {
  sm: '12px 14px',
  md: '16px 18px',
  lg: '20px 22px',
};

const RADIUS: Record<CardSize, number> = {
  sm: radius.button,
  md: radius.card,
  lg: radius.card,
};

const TONE_STYLE: Record<CardTone, React.CSSProperties> = {
  default: {
    background: color.surface,
    ...elevation.card,
  },
  aiAccent: {
    background: color.surface,
    ...elevation.aiAccent,
  },
  inset: {
    background: color.surfaceMuted,
    ...elevation.flat,
  },
  positive: {
    background: color.positiveSubtle,
    border: `1px solid ${color.positive}30`,
    boxShadow: 'none',
  },
  negative: {
    background: color.negativeSubtle,
    border: `1px solid ${color.negative}30`,
    boxShadow: 'none',
  },
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', size = 'md', interactive, as = 'div', style, children, onClick, ...rest },
  ref,
) {
  const Comp = as as 'div';
  const clickable = interactive || !!onClick;
  return (
    <Comp
      ref={ref as never}
      onClick={onClick}
      style={{
        borderRadius: RADIUS[size],
        padding: PADDING[size],
        color: color.text,
        transition: `border-color ${motion.duration.fast}ms ${motion.easing.default}, transform ${motion.duration.fast}ms ${motion.easing.settle}, box-shadow ${motion.duration.fast}ms ${motion.easing.default}`,
        cursor: clickable ? 'pointer' : 'default',
        ...TONE_STYLE[tone],
        ...style,
      }}
      onMouseEnter={clickable ? (e) => {
        const el = e.currentTarget;
        el.style.borderColor = color.borderStrong;
        el.style.transform = 'translateY(-1px)';
        el.style.boxShadow = `0 4px 12px ${color.shadowMd}`;
      } : undefined}
      onMouseLeave={clickable ? (e) => {
        const el = e.currentTarget;
        const base = TONE_STYLE[tone];
        el.style.borderColor = (base.border as string)?.split(' ')[2] ?? color.border;
        el.style.transform = 'none';
        el.style.boxShadow = (base.boxShadow as string) ?? 'none';
      } : undefined}
      {...rest}
    >
      {children}
    </Comp>
  );
});
