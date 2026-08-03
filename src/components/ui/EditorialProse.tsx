'use client';

import React from 'react';
import { color, font, size as sz } from '@/lib/design-tokens';

// Wraps Keisha's long-form output (briefings, memos, coach reviews).
// Fraunces + generous leading = "editorial" register vs the dense
// Inter/mono UI chrome around it.

export interface EditorialProseProps {
  children: React.ReactNode;
  size?: 'body' | 'lg';
}

export function EditorialProse({ children, size = 'body' }: EditorialProseProps) {
  const isLg = size === 'lg';
  return (
    <div
      style={{
        fontFamily: font.serif,
        fontSize: isLg ? sz.subhead.fontSize : sz.bodyLg.fontSize,
        lineHeight: isLg ? '28px' : '24px',
        color: color.text,
      }}
    >
      {children}
    </div>
  );
}
