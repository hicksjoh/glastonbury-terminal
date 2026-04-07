'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GLOSSARY } from '@/lib/glossary';

interface GlossaryTermProps {
  term: string;
  children: React.ReactNode;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: 'above' | 'below';
}

const GlossaryTermComponent: React.FC<GlossaryTermProps> = ({ term, children }) => {
  const [visible, setVisible] = useState<boolean>(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0, placement: 'above' });
  const spanRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const entry = GLOSSARY[term];

  const calculatePosition = useCallback(() => {
    const el = spanRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const nearTop = rect.top < 100;

    setPosition({
      top: nearTop ? rect.bottom + 8 : rect.top - 8,
      left: Math.max(8, rect.left + rect.width / 2),
      placement: nearTop ? 'below' : 'above',
    });
  }, []);

  const show = useCallback(() => {
    calculatePosition();
    setVisible(true);
  }, [calculatePosition]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  // Dismiss on Escape key
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hide();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, hide]);

  // If no glossary entry exists for this term, just render children unstyled
  if (!entry) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={spanRef}
        tabIndex={0}
        role="button"
        aria-describedby={visible ? `glossary-tooltip-${term}` : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{
          borderBottom: '1px dotted #8a5cf6',
          cursor: 'help',
          position: 'relative',
        }}
      >
        {children}
      </span>

      {visible && (
        <div
          id={`glossary-tooltip-${term}`}
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: position.placement === 'above' ? undefined : position.top,
            bottom: position.placement === 'above' ? `calc(100vh - ${position.top}px)` : undefined,
            left: position.left,
            transform: 'translateX(-50%)',
            background: '#1a1a3a',
            border: '1px solid #333',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 12,
            maxWidth: 300,
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontWeight: 'bold',
              color: '#f0c674',
              marginBottom: 4,
              fontSize: 14,
            }}
          >
            {entry.term}
          </div>
          <div
            style={{
              color: '#d0d0e0',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {entry.definition}
          </div>
          {entry.whyItMatters && (
            <div
              style={{
                color: '#888',
                fontSize: 12,
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              Why it matters: {entry.whyItMatters}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export const GlossaryTerm = React.memo(GlossaryTermComponent);
