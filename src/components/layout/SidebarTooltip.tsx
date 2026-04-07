'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { SidebarDescription } from '@/lib/sidebar-descriptions';

interface SidebarTooltipProps {
  description: SidebarDescription | undefined;
  children: React.ReactNode;
}

const SHOW_DELAY = 400;
const TOOLTIP_WIDTH = 240;

function SidebarTooltipInner({ description, children }: SidebarTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const calculatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const tooltipHeight = 80; // approximate
    let top = rect.top + rect.height / 2 - tooltipHeight / 2;

    // Keep tooltip within viewport
    if (top + tooltipHeight > window.innerHeight - 12) {
      top = window.innerHeight - tooltipHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    setPosition({ top, left: rect.right + 8 });
  }, []);

  const show = useCallback(() => {
    if (!description) return;
    timerRef.current = setTimeout(() => {
      calculatePosition();
      setVisible(true);
    }, SHOW_DELAY);
  }, [description, calculatePosition]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      hide();
    }
  }, [hide]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!description) {
    return <>{children}</>;
  }

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={handleKeyDown}
      style={{ position: 'relative' }}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: TOOLTIP_WIDTH,
            backgroundColor: '#1a1a3a',
            border: '1px solid #333',
            borderRadius: 10,
            padding: 12,
            zIndex: 9999,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            opacity: visible ? 1 : 0,
            transition: 'opacity 150ms ease',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            color: '#f0c674',
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 4,
            lineHeight: 1.3,
          }}>
            {description.title}
          </div>
          <div style={{
            color: '#aaa',
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            {description.description}
          </div>
        </div>
      )}
    </div>
  );
}

export const SidebarTooltip = React.memo(SidebarTooltipInner);
