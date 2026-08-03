'use client';

import React, { useCallback, useEffect, useState } from 'react';

// The client-side companion to the server's live-ack layer. Mounts on
// pages that can submit orders (Trading page, Keisha chat). In paper
// mode, renders nothing. In live mode:
//   - checks sessionStorage for a valid ack token
//   - if missing / expired, shows a red full-screen modal requiring the
//     user to type "CONFIRM LIVE" verbatim
//   - stores the minted token in sessionStorage under LIVE_ACK_STORAGE_KEY
//   - the useLiveAck() hook exposes the token to order-submission code
//     so it can add the x-live-ack header

export const LIVE_ACK_STORAGE_KEY = 'glastonbury.liveAck';
export const LIVE_ACK_EXPIRES_KEY = 'glastonbury.liveAckExpiresAt';
const CONFIRM_PHRASE = 'CONFIRM LIVE';

const IS_LIVE_CLIENT = (process.env.NEXT_PUBLIC_TRADING_MODE || 'paper').toLowerCase() === 'live';

interface LiveAckState {
  token: string | null;
  expiresAt: number | null;
  isValid: boolean;
}

function readAck(): LiveAckState {
  if (typeof window === 'undefined') return { token: null, expiresAt: null, isValid: false };
  const token = window.sessionStorage.getItem(LIVE_ACK_STORAGE_KEY);
  const expRaw = window.sessionStorage.getItem(LIVE_ACK_EXPIRES_KEY);
  const expiresAt = expRaw ? Date.parse(expRaw) : null;
  const isValid = !!token && !!expiresAt && expiresAt > Date.now();
  return { token, expiresAt, isValid };
}

function clearAck() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(LIVE_ACK_STORAGE_KEY);
  window.sessionStorage.removeItem(LIVE_ACK_EXPIRES_KEY);
}

/**
 * Get the current live-ack token for use in order-submission fetch calls.
 * Returns null in paper mode (nothing to add) OR if no valid token exists.
 * Callers must add `'x-live-ack': token` to the request headers.
 */
export function useLiveAck(): { token: string | null; isLive: boolean; isAckReady: boolean } {
  const [state, setState] = useState<LiveAckState>(() => readAck());

  useEffect(() => {
    if (!IS_LIVE_CLIENT) return;
    const handler = () => setState(readAck());
    window.addEventListener('storage', handler);
    // Refresh every 60s to catch expiration
    const id = window.setInterval(handler, 60_000);
    return () => {
      window.removeEventListener('storage', handler);
      window.clearInterval(id);
    };
  }, []);

  return {
    token: IS_LIVE_CLIENT ? (state.isValid ? state.token : null) : null,
    isLive: IS_LIVE_CLIENT,
    isAckReady: !IS_LIVE_CLIENT || state.isValid,
  };
}

export function LiveTradingGate() {
  const [needsAck, setNeedsAck] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_LIVE_CLIENT) return;
    const check = () => setNeedsAck(!readAck().isValid);
    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    if (phrase.trim().toUpperCase() !== CONFIRM_PHRASE) {
      setError(`Type "${CONFIRM_PHRASE}" exactly.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/trading/live-ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      window.sessionStorage.setItem(LIVE_ACK_STORAGE_KEY, body.token);
      window.sessionStorage.setItem(LIVE_ACK_EXPIRES_KEY, body.expiresAt);
      setNeedsAck(false);
      setPhrase('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [phrase]);

  const exitLive = useCallback(async () => {
    const token = window.sessionStorage.getItem(LIVE_ACK_STORAGE_KEY);
    if (token) {
      try {
        await fetch('/api/trading/live-ack', {
          method: 'DELETE',
          headers: { 'x-live-ack': token },
        });
      } catch { /* silent */ }
    }
    clearAck();
    setNeedsAck(true);
  }, []);

  if (!IS_LIVE_CLIENT || !needsAck) {
    return IS_LIVE_CLIENT ? (
      <button
        onClick={exitLive}
        title="Revoke live-mode acknowledgment"
        style={{
          position: 'fixed', top: 32, right: 16, zIndex: 9998,
          background: 'rgba(184, 92, 78, 0.9)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          padding: '4px 10px', fontSize: 10, fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.08em', textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        exit live
      </button>
    ) : null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-gate-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5, 3, 3, 0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520, width: '100%',
          background: '#12080a',
          border: '2px solid #B85C4E',
          padding: '32px 36px',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: '#F87171', fontWeight: 700, marginBottom: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ⚠ Live Trading Mode
        </div>
        <h2
          id="live-gate-title"
          style={{
            fontSize: 26, fontWeight: 700, color: '#F87171',
            margin: '0 0 16px', letterSpacing: '-0.01em',
          }}
        >
          Real Money. Real Orders.
        </h2>
        <p style={{ fontSize: 14, color: '#DEDBD5', lineHeight: 1.6, margin: '0 0 20px' }}>
          Every order you place from this session will submit against your <strong>live Alpaca account</strong>.
          Keisha, autopilot rules, and every Place-Order button will send real trades to the market.
        </p>
        <p style={{ fontSize: 13, color: '#8A8A96', lineHeight: 1.6, margin: '0 0 24px' }}>
          To acknowledge, type <code style={{ color: '#F87171', fontFamily: "'JetBrains Mono', monospace", padding: '2px 6px', background: 'rgba(248,113,113,0.1)' }}>{CONFIRM_PHRASE}</code> below.
          Your ack persists for ~4 hours or until you sign out.
        </p>

        <input
          autoFocus
          value={phrase}
          onChange={e => setPhrase(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !submitting) submit(); }}
          placeholder={CONFIRM_PHRASE}
          style={{
            width: '100%', padding: '12px 14px',
            background: '#0A0A0F',
            border: `1px solid ${phrase.trim().toUpperCase() === CONFIRM_PHRASE ? '#F87171' : '#3D3D48'}`,
            color: '#F2F0EC',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14, letterSpacing: '0.1em',
            outline: 'none',
            marginBottom: 12,
          }}
        />

        {error && (
          <div style={{
            fontSize: 12, color: '#F87171', marginBottom: 12,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setPhrase(''); setError(null); }}
            disabled={submitting}
            style={{
              padding: '10px 16px',
              background: 'transparent', border: '1px solid #3D3D48',
              color: '#8A8A96', cursor: 'pointer', fontSize: 13,
              fontWeight: 600,
            }}
          >
            Clear
          </button>
          <button
            onClick={submit}
            disabled={submitting || phrase.trim().toUpperCase() !== CONFIRM_PHRASE}
            style={{
              padding: '10px 20px',
              background: phrase.trim().toUpperCase() === CONFIRM_PHRASE ? '#F87171' : '#3D3D48',
              border: 'none',
              color: phrase.trim().toUpperCase() === CONFIRM_PHRASE ? '#0A0A0F' : '#5A5A64',
              cursor: submitting || phrase.trim().toUpperCase() !== CONFIRM_PHRASE ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 700,
              letterSpacing: '0.04em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {submitting ? 'CONFIRMING…' : 'ACKNOWLEDGE LIVE MODE'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Notional-typed-confirm dialog. Renders a modal that requires the user
 * to type the exact dollar amount (e.g., "7500" for a $7,500 order) to
 * arm the Place-Order button. Consumers pass `notionalUsd` and get back
 * a `typedConfirm` string via `onConfirm`.
 *
 * Only appears when NEXT_PUBLIC_TRADING_MODE=live and notional ≥ threshold.
 */
export interface NotionalConfirmDialogProps {
  open: boolean;
  notionalUsd: number;
  onConfirm: (typedConfirm: string) => void;
  onCancel: () => void;
  thresholdUsd?: number;
}

export function NotionalConfirmDialog({
  open, notionalUsd, onConfirm, onCancel, thresholdUsd = 5_000,
}: NotionalConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  if (!open) return null;

  const expected = Math.round(notionalUsd).toString();
  const matches = typed.trim() === expected;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        background: 'rgba(5, 3, 3, 0.8)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460, width: '100%',
          background: '#12080a', border: '2px solid #B85C4E', padding: '28px 32px',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{
          fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: '#F87171', fontWeight: 700, marginBottom: 8,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          Large Live Order
        </div>
        <div style={{
          fontSize: 32, fontWeight: 700, color: '#F87171',
          margin: '0 0 12px',
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: 'tabular-nums',
        }}>
          ${Number(expected).toLocaleString('en-US')}
        </div>
        <p style={{ fontSize: 13, color: '#DEDBD5', lineHeight: 1.5, margin: '0 0 18px' }}>
          Live order notional exceeds the ${thresholdUsd.toLocaleString()} typed-confirm threshold.
          Type the exact dollar amount below to arm the Place-Order button.
        </p>
        <input
          autoFocus
          value={typed}
          onChange={e => setTyped(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && matches) onConfirm(typed); }}
          placeholder={expected}
          style={{
            width: '100%', padding: '12px 14px',
            background: '#0A0A0F',
            border: `1px solid ${matches ? '#F87171' : '#3D3D48'}`,
            color: '#F2F0EC',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 18, letterSpacing: '0.05em',
            outline: 'none', marginBottom: 16,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 16px', background: 'transparent',
              border: '1px solid #3D3D48', color: '#8A8A96',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => matches && onConfirm(typed)}
            disabled={!matches}
            style={{
              padding: '10px 20px',
              background: matches ? '#F87171' : '#3D3D48',
              border: 'none',
              color: matches ? '#0A0A0F' : '#5A5A64',
              cursor: matches ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 700,
              letterSpacing: '0.04em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            SUBMIT ORDER
          </button>
        </div>
      </div>
    </div>
  );
}
