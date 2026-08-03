'use client';

import React from 'react';
import { color, radius, font, size as sz, weight, tracking, space } from '@/lib/design-tokens';

// The big card at the top of a page. One hero per page — the primary number
// and its context. Uses the ambient "warm obsidian" gradient (subtle gold
// wash from top-right), NOT the pre-2026 purple gradient soup.

export interface HeroCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  metric: React.ReactNode;   // the big number — already formatted
  delta?: React.ReactNode;   // p&l or change chip
  right?: React.ReactNode;   // sparkline, chart, avatar
  children?: React.ReactNode;
}

export function HeroCard({ eyebrow, title, subtitle, metric, delta, right, children }: HeroCardProps) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radius.hero,
        border: `1px solid ${color.borderFaint}`,
        padding: `${space[8]}px ${space[10]}px`,
        marginBottom: space[5],
        background: color.surfaceMuted,
      }}
    >
      {/* Ambient wash — single subtle gold pool from top-right, nothing else */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse at 90% 0%, ${color.goldSubtle} 0%, transparent 55%),
            radial-gradient(ellipse at 0% 100%, rgba(255,255,255,0.02) 0%, transparent 45%)
          `,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: space[6] }}>
        <div>
          {eyebrow && (
            <div
              style={{
                fontSize: sz.label.fontSize,
                fontWeight: weight.semibold,
                letterSpacing: tracking.eyebrow,
                textTransform: 'uppercase',
                color: color.textMuted,
                marginBottom: space[2],
              }}
            >
              {eyebrow}
            </div>
          )}
          <div
            style={{
              fontFamily: font.serif,
              fontSize: sz.h1.fontSize,
              lineHeight: `${sz.h1.lineHeight}px`,
              fontWeight: weight.semibold,
              letterSpacing: tracking.tight,
              color: color.text,
              marginBottom: subtitle ? 4 : 0,
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: sz.bodyLg.fontSize, color: color.textMuted, lineHeight: `${sz.bodyLg.lineHeight}px` }}>
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space[3], justifyContent: 'flex-end' }}>
            {right}
            <span
              style={{
                fontFamily: font.mono,
                fontSize: sz.hero.fontSize,
                lineHeight: `${sz.hero.lineHeight}px`,
                fontWeight: weight.bold,
                color: color.text,
                letterSpacing: tracking.tight,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {metric}
            </span>
          </div>
          {delta && (
            <div style={{ marginTop: space[1] }}>{delta}</div>
          )}
        </div>
      </div>

      {children && (
        <div style={{ position: 'relative', zIndex: 1, marginTop: space[6] }}>{children}</div>
      )}
    </div>
  );
}
