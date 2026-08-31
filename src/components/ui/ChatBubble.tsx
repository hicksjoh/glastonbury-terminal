'use client';

import React from 'react';
import { color, font, size as sz, space, semantic } from '@/lib/design-tokens';

// The one chat bubble. Wraps user vs assistant.
// Long-form assistant content uses Fraunces (font.serif) via the
// `editorial` prop — briefings, memos, coach reviews.

export interface ChatBubbleProps {
  role: 'user' | 'assistant';
  editorial?: boolean;
  compact?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;   // model badge, tokens/latency, copy button row
}

export function ChatBubble({ role, editorial, compact, children, footer }: ChatBubbleProps) {
  const isUser = role === 'user';
  const base = isUser ? semantic.chatBubbleUser : semantic.chatBubbleAssistant;

  return (
    <div
      className="msg-bubble"
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: isUser ? '82%' : '92%',
        padding: compact ? `${space[3]}px ${space[4]}px` : `${space[4]}px ${space[5]}px`,
        marginBottom: space[3],
        ...base,
      }}
    >
      <div
        style={{
          fontFamily: editorial && !isUser ? font.serif : font.sans,
          fontSize: editorial ? sz.bodyLg.fontSize : sz.base.fontSize,
          lineHeight: editorial ? '24px' : `${sz.base.lineHeight}px`,
          color: color.text,
        }}
      >
        {children}
      </div>
      {footer && (
        <div
          className="msg-actions"
          style={{
            marginTop: space[2],
            opacity: 0.6,
            transition: 'opacity 120ms ease',
            display: 'flex',
            alignItems: 'center',
            gap: space[3],
            fontSize: sz.label.fontSize,
            color: color.textDim,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
