'use client';

import React from 'react';
import { color, size as sz, weight, tracking, space } from '@/lib/design-tokens';

// The one-and-only section eyebrow. Replaces ~150 instances of
// `fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase',
//  letterSpacing: '0.05em'` scattered across the app.

export interface SectionHeaderProps {
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function SectionHeader({ children, action }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: space[3],
      }}
    >
      <div
        style={{
          fontSize: sz.label.fontSize,
          fontWeight: weight.semibold,
          color: color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: tracking.eyebrow,
        }}
      >
        {children}
      </div>
      {action}
    </div>
  );
}
