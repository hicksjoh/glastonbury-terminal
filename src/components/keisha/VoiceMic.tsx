'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';

// ─── Web Speech API shims (webkit prefix on Safari/Chrome) ───────────────────
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
};
type WindowWithSR = Window & {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
};

function getSR(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSR;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, []);
  return reduced;
}

// ─── Audio player: MediaSource streaming MP3 ─────────────────────────────────
type AudioQueue = {
  appendBase64: (b64: string) => void;
  stop: () => void;
  audioEl: HTMLAudioElement | null;
  play: () => Promise<void>;
};

function createAudioQueue(): AudioQueue {
  const audioEl = new Audio();
  audioEl.autoplay = false;
  audioEl.preload = 'auto';

  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;

  const msSupported =
    typeof window !== 'undefined' &&
    typeof window.MediaSource !== 'undefined' &&
    window.MediaSource.isTypeSupported('audio/mpeg');

  if (msSupported) {
    mediaSource = new MediaSource();
    audioEl.src = URL.createObjectURL(mediaSource);
    mediaSource.addEventListener('sourceopen', () => {
      if (!mediaSource) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        sourceBuffer.addEventListener('updateend', flushPending);
      } catch {
        // fall back silently — some browsers refuse mpeg SourceBuffer
      }
    });
  }

  // Fallback: accumulate into a Blob and swap src on stop
  const fallbackChunks: Uint8Array[] = [];

  function flushPending() {
    if (closed) return;
    if (!sourceBuffer || sourceBuffer.updating) return;
    const next = pending.shift();
    if (!next) return;
    try {
      // Slice to a fresh ArrayBuffer to satisfy BufferSource typing across engines
      const ab = next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer;
      sourceBuffer.appendBuffer(ab);
    } catch {
      // Buffer full / invalid — drop
    }
  }

  function decode(b64: string): Uint8Array {
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
  }

  return {
    audioEl,
    appendBase64(b64: string) {
      if (closed) return;
      const bytes = decode(b64);
      if (msSupported && sourceBuffer) {
        pending.push(bytes);
        flushPending();
      } else {
        fallbackChunks.push(bytes);
      }
    },
    async play() {
      try { await audioEl.play(); } catch { /* user-gesture requirement may block */ }
    },
    stop() {
      closed = true;
      try { audioEl.pause(); audioEl.src = ''; } catch { /* noop */ }
      try { if (mediaSource && mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch { /* noop */ }
      pending.length = 0;
      fallbackChunks.length = 0;
    },
  };
}

// ─── Main component ──────────────────────────────────────────────────────────
type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

type HistoryTurn = { role: 'user' | 'assistant'; content: string };

const MAX_HISTORY_TURNS = 8;

export function VoiceMic() {
  const reducedMotion = usePrefersReducedMotion();

  const [status, setStatus] = useState<Status>('idle');
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sttSupported, setSttSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const transcriptRef = useRef<string>('');

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  useEffect(() => {
    setSttSupported(!!getSR());
    return () => {
      recognitionRef.current?.abort();
      abortRef.current?.abort();
      audioQueueRef.current?.stop();
    };
  }, []);

  // ── Barge-in (manual: click mic or press Space while audio playing) ────────
  const bargeIn = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    audioQueueRef.current?.stop();
    audioQueueRef.current = null;
    setStatus('idle');
  }, []);

  // ── Send transcript to voice API and stream response ──────────────────────
  const sendToKeisha = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setStatus('thinking');
    setAssistantText('');
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    // Play tone unlock — user gesture already happened on mic click
    const queue = createAudioQueue();
    audioQueueRef.current = queue;

    const historyForRequest: HistoryTurn[] = history.slice(-MAX_HISTORY_TURNS);

    try {
      const res = await fetch('/api/keisha/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, history: historyForRequest }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const msg = `voice API error ${res.status}`;
        setError(msg);
        setStatus('idle');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstAudioReceived = false;
      let fullText = '';

      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames — each event ends with \n\n
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let parsed: {
            type: string;
            delta?: string;
            chunk?: string;
            model?: string;
            message?: string;
            source?: string;
          };
          try { parsed = JSON.parse(payload); } catch { continue; }

          if (parsed.type === 'text' && parsed.delta) {
            fullText += parsed.delta;
            setAssistantText(fullText);
          } else if (parsed.type === 'audio' && parsed.chunk) {
            queue.appendBase64(parsed.chunk);
            if (!firstAudioReceived) {
              firstAudioReceived = true;
              setStatus('speaking');
              await queue.play();
            }
          } else if (parsed.type === 'done') {
            // flush pending, let audio element play out naturally
          } else if (parsed.type === 'error') {
            setError(`${parsed.source ?? 'error'}: ${parsed.message ?? 'unknown'}`);
          }
        }
      }

      // Commit this turn to history
      setHistory(h => [
        ...h.slice(-(MAX_HISTORY_TURNS * 2)),
        { role: 'user', content: text },
        { role: 'assistant', content: fullText },
      ]);

      // Wait for audio to finish (simple approach: listen for ended)
      const audioEl = queue.audioEl;
      if (audioEl && firstAudioReceived) {
        await new Promise<void>(resolve => {
          const onEnd = () => { audioEl.removeEventListener('ended', onEnd); resolve(); };
          audioEl.addEventListener('ended', onEnd);
          // Hard timeout 60s
          setTimeout(resolve, 60_000);
        });
      }

      setStatus('idle');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
      setStatus('idle');
    } finally {
      abortRef.current = null;
    }
  }, [history]);

  // ── Microphone / SpeechRecognition ────────────────────────────────────────
  const startListening = useCallback(() => {
    // Barge-in: if audio is playing, stop it first
    if (status === 'thinking' || status === 'speaking') {
      bargeIn();
    }

    const Ctor = getSR();
    if (!Ctor) {
      setSttSupported(false);
      setError('Speech recognition unavailable in this browser');
      return;
    }

    setTranscript('');
    setInterim('');
    setAssistantText('');
    setError(null);
    setExpanded(true);

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recognitionRef.current = rec;

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let finalSegment = '';
      let interimSegment = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalSegment += r[0].transcript;
        else interimSegment += r[0].transcript;
      }
      if (finalSegment) setTranscript(prev => (prev + ' ' + finalSegment).trim());
      setInterim(interimSegment);
    };

    rec.onerror = (e: { error: string }) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(`Mic error: ${e.error}`);
      setStatus('idle');
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setInterim('');
      const text = transcriptRef.current.trim();
      if (text) {
        sendToKeisha(text);
      } else {
        setStatus('idle');
      }
    };

    try {
      rec.start();
      setStatus('listening');
    } catch (err) {
      setError(`Mic start failed: ${(err as Error).message}`);
      setStatus('idle');
    }
  }, [status, bargeIn, sendToKeisha]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // ── Cmd+K shortcut ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (status === 'listening') stopListening();
        else startListening();
      } else if (e.key === ' ' && (status === 'thinking' || status === 'speaking') && expanded) {
        // Spacebar barge-in while speaking — only when expanded so we don't break scroll
        e.preventDefault();
        bargeIn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, startListening, stopListening, bargeIn, expanded]);

  // ── Primary click handler: toggle listen / barge-in / start ───────────────
  const onMicClick = useCallback(() => {
    if (status === 'listening') {
      stopListening();
    } else if (status === 'thinking' || status === 'speaking') {
      bargeIn();
    } else {
      startListening();
    }
  }, [status, startListening, stopListening, bargeIn]);

  // ── Orb color by state ────────────────────────────────────────────────────
  const orbColor = useMemo(() => {
    switch (status) {
      case 'listening': return '#f0c674'; // amber
      case 'thinking':  return '#8a5cf6'; // purple
      case 'speaking':  return '#4ade80'; // green
      default:          return '#666';    // idle gray
    }
  }, [status]);

  const pulseAnimation = reducedMotion ? 'none' : 'vm-pulse 1.4s ease-in-out infinite';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      role="region"
      aria-label="Keisha voice mode"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {/* Expanded panel */}
      {expanded && (
        <div
          style={{
            width: 360,
            maxWidth: 'calc(100vw - 48px)',
            maxHeight: 420,
            padding: 16,
            background: 'rgba(8, 11, 20, 0.96)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${orbColor}40`,
            borderRadius: 16,
            boxShadow: `0 12px 48px ${orbColor}30`,
            color: '#e8e8e8',
            fontSize: 13,
            lineHeight: 1.5,
            overflow: 'auto',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: orbColor,
                animation: status !== 'idle' ? pulseAnimation : 'none',
              }} />
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: orbColor }}>
                {status === 'idle' ? 'Ready' :
                 status === 'listening' ? 'Listening' :
                 status === 'thinking' ? 'Thinking' :
                 'Speaking'}
              </span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              aria-label="Close voice panel"
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}
            >
              <X size={14} />
            </button>
          </div>

          {!sttSupported && (
            <div style={{ padding: 10, borderRadius: 8, background: '#2a1010', color: '#f87171', fontSize: 12, marginBottom: 10 }}>
              Your browser doesn&apos;t support voice input. Chrome or Safari recommended.
            </div>
          )}

          {error && (
            <div style={{ padding: 10, borderRadius: 8, background: '#2a1010', color: '#f87171', fontSize: 12, marginBottom: 10 }}>
              {error}
            </div>
          )}

          {/* Wes's transcript */}
          {(transcript || interim) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                You
              </div>
              <div style={{ color: '#bbb', fontStyle: interim && !transcript ? 'italic' : 'normal' }}>
                {transcript} <span style={{ color: '#555', fontStyle: 'italic' }}>{interim}</span>
              </div>
            </div>
          )}

          {/* Keisha's response */}
          {assistantText && (
            <div>
              <div style={{ fontSize: 10, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Keisha
              </div>
              <div style={{ color: '#e8e8e8' }}>{assistantText}</div>
            </div>
          )}

          {!transcript && !interim && !assistantText && !error && (
            <div style={{ fontSize: 12, color: '#777', padding: '8px 0' }}>
              Tap the mic or press <kbd style={{ padding: '1px 5px', border: '1px solid #333', borderRadius: 4, fontSize: 10 }}>⌘K</kbd> to start talking to Keisha.
            </div>
          )}

          {(status === 'thinking' || status === 'speaking') && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#666' }}>
              Tap mic or press <kbd style={{ padding: '1px 5px', border: '1px solid #333', borderRadius: 4, fontSize: 10 }}>Space</kbd> to interrupt.
            </div>
          )}
        </div>
      )}

      {/* Floating mic button */}
      <button
        onClick={onMicClick}
        aria-label={
          status === 'listening' ? 'Stop listening' :
          (status === 'thinking' || status === 'speaking') ? 'Interrupt Keisha' :
          'Start talking to Keisha (Cmd+K)'
        }
        title="Talk to Keisha (⌘K)"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${orbColor}, ${orbColor}aa)`,
          border: `2px solid ${orbColor}`,
          boxShadow: `0 6px 24px ${orbColor}60`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#080b14',
          transition: 'transform 150ms ease',
          transform: status !== 'idle' ? 'scale(1.05)' : 'scale(1)',
          pointerEvents: 'auto',
          animation: status === 'listening' && !reducedMotion ? 'vm-pulse 1.4s ease-in-out infinite' : 'none',
        }}
      >
        {(status === 'thinking' || status === 'speaking') ? <Square size={20} fill="#080b14" /> : <Mic size={22} />}
      </button>

      {/* Keyframes for pulse */}
      <style jsx global>{`
        @keyframes vm-pulse {
          0%, 100% { box-shadow: 0 6px 24px ${orbColor}60; }
          50%      { box-shadow: 0 6px 36px ${orbColor}aa; }
        }
      `}</style>
    </div>
  );
}

export default VoiceMic;
