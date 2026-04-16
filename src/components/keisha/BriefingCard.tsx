'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

type StreamEvent =
  | { type: 'meta'; cached: boolean; model?: string; briefingId?: string; createdAt?: string }
  | { type: 'model'; model: string }
  | { type: 'token'; text: string }
  | { type: 'done'; cached: boolean; briefingId?: string | null; model?: string; tokensIn?: number; tokensOut?: number; latencyMs?: number; costUsd?: number }
  | { type: 'error'; message: string };

function GlassShell({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '20px 22px',
        overflow: 'hidden',
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid rgba(138, 92, 246, ${hovered ? 0.3 : 0.12})`,
        borderRadius: 14,
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(138, 92, 246, 0.08)' : 'none',
      }}
    >
      {children}
    </div>
  );
}

function formatTimeAgo(at: Date | null): string {
  if (!at) return 'Loading...';
  const diff = Date.now() - at.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return at.toLocaleDateString();
}

export function BriefingCard() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [, setTick] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const startStream = useCallback((opts?: { refresh?: boolean }) => {
    closeStream();
    setText('');
    setError(null);
    setCached(false);
    setModelUsed(null);
    setStatus('streaming');

    const qs = new URLSearchParams();
    if (opts?.refresh) qs.set('refresh', 'true');
    const url = `/api/keisha/briefing${qs.toString() ? `?${qs.toString()}` : ''}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (e) => {
      let payload: StreamEvent;
      try {
        payload = JSON.parse(e.data) as StreamEvent;
      } catch {
        return;
      }
      switch (payload.type) {
        case 'meta':
          setCached(!!payload.cached);
          if (payload.createdAt) setFetchedAt(new Date(payload.createdAt));
          if (payload.model) setModelUsed(payload.model);
          break;
        case 'model':
          setModelUsed(payload.model);
          break;
        case 'token':
          setText(prev => prev + payload.text);
          break;
        case 'done':
          if (!payload.cached) setFetchedAt(new Date());
          if (payload.model) setModelUsed(payload.model);
          setStatus('done');
          closeStream();
          break;
        case 'error':
          setError(payload.message);
          setStatus('error');
          closeStream();
          break;
      }
    };

    es.onerror = () => {
      if (sourceRef.current === es) {
        setStatus(prev => (prev === 'done' ? 'done' : 'error'));
        if (status !== 'done') setError('Briefing stream disconnected');
        closeStream();
      }
    };
  }, [closeStream, status]);

  // Mount: start once
  useEffect(() => {
    startStream();
    return () => closeStream();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick relative timestamp every 30s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const isStreaming = status === 'streaming';
  const isIdleEmpty = !text && isStreaming;

  return (
    <GlassShell>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, #f0c674, #c9a84c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: '#080b14',
          }}>K</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Keisha — AI Briefing
            </div>
            <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{isStreaming ? (cached ? 'Replaying…' : 'Streaming…') : formatTimeAgo(fetchedAt)}</span>
              {cached && <span style={{ color: '#4ade80' }}>• cached</span>}
              {modelUsed && !isStreaming && <span style={{ color: '#666' }}>• {modelUsed}</span>}
            </div>
          </div>
        </div>
        <button
          onClick={() => startStream({ refresh: true })}
          disabled={isStreaming}
          style={{
            background: 'none', border: 'none',
            color: isStreaming ? '#333' : '#666',
            cursor: isStreaming ? 'not-allowed' : 'pointer',
            padding: 4, fontSize: 14,
          }}
          title="Regenerate briefing"
        >
          ↻
        </button>
      </div>

      {/* Body */}
      {isIdleEmpty ? (
        <div style={{ display: 'flex', gap: 6, padding: '20px 0' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#f0c674', opacity: 0.5,
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      ) : error && !text ? (
        <div style={{ fontSize: 13, color: '#f87171', padding: '8px 0' }}>
          {error}
          <button
            onClick={() => startStream({ refresh: true })}
            style={{
              marginLeft: 10, background: 'none', border: '1px solid #f87171',
              color: '#f87171', padding: '2px 8px', borderRadius: 6,
              fontSize: 11, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{
            maxHeight: expanded ? 'none' : 180,
            overflow: 'hidden',
            transition: 'max-height 0.4s ease',
          }}>
            <MarkdownRenderer content={text} compact />
            {isStreaming && (
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block', width: 8, height: 14,
                  background: '#f0c674', marginLeft: 2, verticalAlign: 'middle',
                  animation: 'blink 1s steps(1) infinite',
                }}
              />
            )}
          </div>
          {!expanded && text.length > 300 && !isStreaming && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
              background: 'linear-gradient(transparent, rgba(8, 11, 20, 0.95))',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
            }}>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  background: 'none', border: 'none', color: '#f0c674',
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}
              >
                Read full briefing →
              </button>
            </div>
          )}
          {expanded && !isStreaming && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                background: 'none', border: 'none', color: '#888',
                fontSize: 11, cursor: 'pointer', marginTop: 8,
              }}
            >
              Collapse ↑
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </GlassShell>
  );
}

export default BriefingCard;
