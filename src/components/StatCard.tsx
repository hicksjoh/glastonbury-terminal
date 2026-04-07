'use client';

import { ReactNode } from 'react';

/**
 * StatCard — reusable metric card with consistent terminal styling.
 * Uses CSS variables for theming.
 */
export function StatCard({
  label,
  value,
  subValue,
  icon,
  accent,
  onClick,
}: {
  label: string;
  value: string | ReactNode;
  subValue?: string | ReactNode;
  icon?: ReactNode;
  accent?: 'gold' | 'green' | 'red' | 'muted';
  onClick?: () => void;
}) {
  const accentColor = {
    gold: 'var(--gold)',
    green: 'var(--green)',
    red: 'var(--red)',
    muted: 'var(--text-muted)',
  }[accent || 'gold'];

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '18px 20px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.borderColor = 'var(--gold-dim)';
          e.currentTarget.style.boxShadow = '0 0 20px rgba(201, 168, 76, 0.08)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        {icon && <span style={{ fontSize: 16, opacity: 0.6 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accentColor, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {subValue}
        </div>
      )}
    </div>
  );
}
