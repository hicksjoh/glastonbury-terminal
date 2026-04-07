'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { OptionsCardData } from '@/types/keisha';

// ─── Currency formatter ────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// ─── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: '#12122a',
  borderLeft: '4px solid #22d3ee',
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
  marginBottom: 4,
  maxWidth: '100%',
  transition: 'transform 150ms ease, box-shadow 150ms ease',
  animation: 'optionsCardIn 200ms ease forwards',
};

const containerHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
};

const premiumRowStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 18,
  fontWeight: 700,
  color: '#f0c674',
  fontFamily: "'JetBrains Mono', monospace",
};

const greeksGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  marginTop: 12,
};

const greekLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#8888a8',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const greekValueBase: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
};

const ivBreakevenRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  marginTop: 12,
  fontSize: 12,
  color: '#8888a8',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 10,
  flexWrap: 'wrap',
};

const buttonBase: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid #2a2a3a',
  background: 'rgba(255,255,255,0.03)',
  color: '#8888a8',
  fontSize: 11,
  cursor: 'pointer',
  transition: 'border-color 150ms ease, color 150ms ease',
};

// ─── Keyframe injection ────────────────────────────────────────────────────

const KEYFRAME_ID = 'options-card-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes optionsCardIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatExpiration(isoDate: string): string {
  const d = new Date(isoDate);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

// ─── ActionButton (internal) ───────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  ariaLabel: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

function ActionButton({ label, ariaLabel, onClick }: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = {
    ...buttonBase,
    ...(hovered ? { borderColor: '#22d3ee', color: '#67e8f9' } : {}),
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {label}
    </button>
  );
}

// ─── OptionsCard ───────────────────────────────────────────────────────────

interface OptionsCardProps {
  data: OptionsCardData;
}

function OptionsCard({ data }: OptionsCardProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const typeLabel = data.type === 'call' ? 'C' : 'P';
  const expirationFormatted = formatExpiration(data.expiration);

  const handleExecute = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push(`/trading?symbol=${data.symbol}&type=option`);
    },
    [router, data.symbol],
  );

  const handleShowChain = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push(`/trading/options/builder?symbol=${data.symbol}`);
    },
    [router, data.symbol],
  );

  const handleAddToStrategy = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      router.push('/strategies');
    },
    [router],
  );

  const mergedContainerStyle: React.CSSProperties = {
    ...containerStyle,
    ...(hovered ? containerHoverStyle : {}),
  };

  return (
    <div
      style={mergedContainerStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Header: Contract descriptor ─────────────────────────── */}
      <div style={headerRowStyle}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#ffffff' }}>
          {data.symbol}
        </span>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#f0c674' }}>
          {data.strike}{typeLabel}
        </span>
        <span style={{ fontSize: 13, color: '#8888a8' }}>
          {expirationFormatted}
        </span>
      </div>

      {/* ── Premium ─────────────────────────────────────────────── */}
      <div style={premiumRowStyle}>
        Premium: {usd.format(data.premium)}
      </div>

      {/* ── Greeks 2x2 Grid ─────────────────────────────────────── */}
      <div style={greeksGridStyle}>
        {/* Delta */}
        <div>
          <div style={greekLabelStyle}>Delta</div>
          <div
            style={{
              ...greekValueBase,
              color: data.greeks.delta >= 0 ? '#22c55e' : '#ffffff',
            }}
          >
            {data.greeks.delta.toFixed(3)}
          </div>
        </div>

        {/* Gamma */}
        <div>
          <div style={greekLabelStyle}>Gamma</div>
          <div style={{ ...greekValueBase, color: '#ffffff' }}>
            {data.greeks.gamma.toFixed(4)}
          </div>
        </div>

        {/* Theta */}
        <div>
          <div style={greekLabelStyle}>Theta</div>
          <div style={{ ...greekValueBase, color: '#ef4444' }}>
            {data.greeks.theta < 0
              ? data.greeks.theta.toFixed(3)
              : `-${data.greeks.theta.toFixed(3)}`}
          </div>
        </div>

        {/* Vega */}
        <div>
          <div style={greekLabelStyle}>Vega</div>
          <div style={{ ...greekValueBase, color: '#ffffff' }}>
            {data.greeks.vega.toFixed(3)}
          </div>
        </div>
      </div>

      {/* ── IV + Breakeven ──────────────────────────────────────── */}
      <div style={ivBreakevenRowStyle}>
        <span>
          IV:{' '}
          <span style={{ color: '#ffffff', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {data.iv.toFixed(1)}%
          </span>
        </span>
        <span>
          Breakeven:{' '}
          <span style={{ color: '#ffffff', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            {usd.format(data.breakeven)}
          </span>
        </span>
      </div>

      {/* ── Action Buttons ──────────────────────────────────────── */}
      <div style={buttonRowStyle}>
        <ActionButton
          label="Execute"
          ariaLabel={`Execute ${data.symbol} ${data.strike}${typeLabel} option`}
          onClick={handleExecute}
        />
        <ActionButton
          label="Show Chain"
          ariaLabel={`Show options chain for ${data.symbol}`}
          onClick={handleShowChain}
        />
        <ActionButton
          label="Add to Strategy"
          ariaLabel={`Add ${data.symbol} ${data.strike}${typeLabel} to strategy builder`}
          onClick={handleAddToStrategy}
        />
      </div>
    </div>
  );
}

// ─── Memoized export ───────────────────────────────────────────────────────

export default React.memo(OptionsCard);
