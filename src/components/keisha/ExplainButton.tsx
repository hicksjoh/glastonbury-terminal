'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ExplainButtonProps {
  messageContent: string;
  messageId: string;
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

const ExplainButtonComponent: React.FC<ExplainButtonProps> = ({ messageContent, messageId }) => {
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [explanation, setExplanation] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const cache = useRef<Map<string, string>>(new Map());
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(async () => {
    // If already open with a successful result, just toggle closed
    if (isOpen && status === 'success') {
      setIsOpen(false);
      return;
    }

    // If we have a cached result, use it
    const cached = cache.current.get(messageId);
    if (cached) {
      setExplanation(cached);
      setStatus('success');
      setIsOpen(true);
      return;
    }

    // Fetch a new explanation
    setStatus('loading');
    setIsOpen(true);

    try {
      const res = await fetch('/api/keisha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user' as const,
              content:
                "Re-explain your previous response as if talking to a smart friend who doesn't trade. No jargon. Use real-world analogies. Maximum 3 sentences.",
            },
          ],
          domain: 'general',
        }),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const data: { content: string } = await res.json();
      cache.current.set(messageId, data.content);
      setExplanation(data.content);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, [isOpen, status, messageId]);

  // Animate card open/close via max-height
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    if (isOpen) {
      // Set max-height to scrollHeight so CSS transition kicks in
      card.style.maxHeight = `${card.scrollHeight}px`;
    } else {
      card.style.maxHeight = '0px';
    }
  }, [isOpen, explanation, status]);

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={handleClick}
        aria-expanded={isOpen}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6,
          color: '#d0d0e0',
          cursor: 'pointer',
          fontSize: 13,
          padding: '4px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          transition: 'border-color 200ms, color 200ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(240,198,116,0.5)';
          e.currentTarget.style.color = '#f0c674';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
          e.currentTarget.style.color = '#d0d0e0';
        }}
      >
        <span role="img" aria-label="lightbulb">
          💡
        </span>{' '}
        Explain simpler
      </button>

      <div
        ref={cardRef}
        style={{
          maxHeight: 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <div
          style={{
            background: '#1a1a3a',
            borderLeft: '2px solid #f0c674',
            borderRadius: 8,
            padding: 16,
            marginTop: 8,
            color: '#d0d0e0',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {status === 'loading' && <PulsingDots />}

          {status === 'success' && <p style={{ margin: 0 }}>{explanation}</p>}

          {status === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#e06c75' }}>
                Couldn&apos;t simplify — try asking Keisha directly
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatus('idle');
                  handleClick();
                }}
                style={{
                  background: 'rgba(240,198,116,0.15)',
                  border: '1px solid #f0c674',
                  borderRadius: 4,
                  color: '#f0c674',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 8px',
                }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes keisha-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

const PulsingDots: React.FC = () => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 20 }}>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#f0c674',
          display: 'inline-block',
          animation: `keisha-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }}
      />
    ))}
  </div>
);

export const ExplainButton = React.memo(ExplainButtonComponent);
