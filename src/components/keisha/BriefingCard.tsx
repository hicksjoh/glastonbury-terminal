'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { Card, EditorialProse, ModelBadge, PillBadge, StreamingIndicator } from '@/components/ui';
import { color, font, size as sz, weight, tracking, space, radius, motion } from '@/lib/design-tokens';

// The Keisha AI Briefing card — dashboard hero for streaming Claude output.
// This is the showcase for the design system's AI surfaces:
//   - Card tone="aiAccent" (gold-ring elevation)
//   - EditorialProse for the long-form body (Fraunces)
//   - StreamingIndicator (three-dot pulse + inline cursor)
//   - ModelBadge for the "Opus 4.7 · 1.2s · cached" chip
// See docs/DESIGN-SYSTEM.md.

type StreamEvent =
  | { type: 'meta';  cached: boolean; model?: string; briefingId?: string; createdAt?: string }
  | { type: 'model'; model: string }
  | { type: 'token'; text: string }
  | { type: 'done';  cached: boolean; briefingId?: string | null; model?: string;
      tokensIn?: number; tokensOut?: number; latencyMs?: number; costUsd?: number }
  | { type: 'error'; message: string };

function formatTimeAgo(at: Date | null): string {
  if (!at) return 'Loading…';
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
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const sourceRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTokenAtRef = useRef<number>(0);
  const STREAM_OVERALL_TIMEOUT_MS = 45_000;
  const STREAM_IDLE_TIMEOUT_MS = 20_000;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    clearWatchdog();
  }, [clearWatchdog]);

  const startStream = useCallback((opts?: { refresh?: boolean }) => {
    closeStream();
    setText('');
    setError(null);
    setCached(false);
    setModelUsed(null);
    setLatencyMs(null);
    setStatus('streaming');
    lastTokenAtRef.current = Date.now();

    const qs = new URLSearchParams();
    if (opts?.refresh) qs.set('refresh', 'true');
    const url = `/api/keisha/briefing${qs.toString() ? `?${qs.toString()}` : ''}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    const startedAt = Date.now();
    const tick = () => {
      const now = Date.now();
      const sinceStart = now - startedAt;
      const sinceToken = now - lastTokenAtRef.current;
      if (sourceRef.current !== es) return;
      if (sinceStart > STREAM_OVERALL_TIMEOUT_MS || sinceToken > STREAM_IDLE_TIMEOUT_MS) {
        setError('Briefing timed out — tap retry');
        setStatus('error');
        closeStream();
        return;
      }
      watchdogRef.current = setTimeout(tick, 2_000);
    };
    watchdogRef.current = setTimeout(tick, 2_000);

    es.onmessage = (e) => {
      let payload: StreamEvent;
      try { payload = JSON.parse(e.data) as StreamEvent; }
      catch { return; }
      switch (payload.type) {
        case 'meta':
          setCached(!!payload.cached);
          if (payload.createdAt) setFetchedAt(new Date(payload.createdAt));
          if (payload.model) setModelUsed(payload.model);
          lastTokenAtRef.current = Date.now();
          break;
        case 'model':
          setModelUsed(payload.model);
          lastTokenAtRef.current = Date.now();
          break;
        case 'token':
          lastTokenAtRef.current = Date.now();
          setText(prev => prev + payload.text);
          break;
        case 'done':
          if (!payload.cached) setFetchedAt(new Date());
          if (payload.model) setModelUsed(payload.model);
          if (typeof payload.latencyMs === 'number') setLatencyMs(payload.latencyMs);
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

  useEffect(() => {
    startStream();
    return () => closeStream();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const isStreaming = status === 'streaming';
  const isIdleEmpty = !text && isStreaming;

  return (
    <Card size="lg" tone="aiAccent">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[4],
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
          {/* Keisha avatar — single gold, no gradient */}
          <div
            aria-hidden="true"
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: color.gold,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: font.serif,
              fontSize: 15, fontWeight: weight.bold, color: color.bg,
              boxShadow: `0 0 0 3px ${color.goldSubtle}`,
            }}
          >
            K
          </div>
          <div>
            <div style={{
              fontSize: sz.label.fontSize, fontWeight: weight.semibold, color: color.gold,
              textTransform: 'uppercase', letterSpacing: tracking.eyebrow,
            }}>
              Keisha — AI Briefing
            </div>
            <div style={{
              fontSize: sz.micro.fontSize, color: color.textDim,
              display: 'flex', gap: space[2], alignItems: 'center', marginTop: 2,
            }}>
              <span>{isStreaming ? (cached ? 'Replaying…' : 'Streaming…') : formatTimeAgo(fetchedAt)}</span>
              {cached && <PillBadge tone="positive" size="sm">cached</PillBadge>}
              {isStreaming && <StreamingIndicator />}
            </div>
          </div>
        </div>
        <button
          onClick={() => startStream({ refresh: true })}
          disabled={isStreaming}
          aria-label="Regenerate briefing"
          title="Regenerate briefing"
          style={{
            background: 'none', border: `1px solid ${color.border}`, borderRadius: radius.button,
            color: isStreaming ? color.textFaint : color.textMuted,
            cursor: isStreaming ? 'not-allowed' : 'pointer',
            padding: '6px 10px', fontSize: sz.body.fontSize,
            transition: `all ${motion.duration.fast}ms ${motion.easing.default}`,
          }}
        >
          ↻
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      {isIdleEmpty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: `${space[5]}px 0` }}>
          <StreamingIndicator label="Keisha is compiling your briefing" />
        </div>
      ) : error && !text ? (
        <div style={{
          fontSize: sz.bodyLg.fontSize, color: color.negative, padding: `${space[2]}px 0`,
          display: 'flex', alignItems: 'center', gap: space[3],
        }}>
          <span>{error}</span>
          <button
            onClick={() => startStream({ refresh: true })}
            style={{
              background: 'transparent', border: `1px solid ${color.negative}`,
              color: color.negative, padding: '4px 10px', borderRadius: radius.button,
              fontSize: sz.label.fontSize, fontWeight: weight.semibold, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{
            maxHeight: expanded ? 'none' : 200,
            overflow: 'hidden',
            transition: `max-height ${motion.duration.slow}ms ${motion.easing.settle}`,
          }}>
            <EditorialProse>
              <MarkdownRenderer content={text} compact />
              {isStreaming && <StreamingIndicator variant="cursor" />}
            </EditorialProse>
          </div>

          {!expanded && text.length > 300 && !isStreaming && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 72,
              background: `linear-gradient(transparent, ${color.surface} 85%)`,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: space[1],
              pointerEvents: 'none',
            }}>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  pointerEvents: 'auto',
                  background: 'transparent', border: `1px solid ${color.gold}30`,
                  color: color.gold, padding: '4px 12px', borderRadius: radius.full,
                  fontSize: sz.label.fontSize, fontWeight: weight.semibold, cursor: 'pointer',
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
                background: 'none', border: 'none', color: color.textMuted,
                fontSize: sz.label.fontSize, cursor: 'pointer', marginTop: space[2],
              }}
            >
              Collapse ↑
            </button>
          )}
        </div>
      )}

      {/* ── Footer (model + telemetry) ─────────────────────────── */}
      {!isStreaming && !error && text && (
        <div style={{
          marginTop: space[3], paddingTop: space[3],
          borderTop: `1px solid ${color.borderFaint}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space[3],
        }}>
          <ModelBadge model={modelUsed} latencyMs={latencyMs ?? undefined} cached={cached} />
          <span style={{ fontSize: sz.micro.fontSize, color: color.textDim, fontFamily: font.mono }}>
            {formatTimeAgo(fetchedAt)}
          </span>
        </div>
      )}
    </Card>
  );
}

export default BriefingCard;
