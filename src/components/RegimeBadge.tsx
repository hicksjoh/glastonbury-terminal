'use client';

import { useEffect, useState } from 'react';

const REGIME_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  bull_low_vol: { label: 'BULL \u00B7 LOW VOL', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  bull_high_vol: { label: 'BULL \u00B7 HIGH VOL', color: '#f0c674', bg: 'rgba(240,198,116,0.1)' },
  bear_low_vol: { label: 'BEAR \u00B7 LOW VOL', color: '#f0c674', bg: 'rgba(240,198,116,0.1)' },
  bear_high_vol: { label: 'BEAR \u00B7 HIGH VOL', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
};

export function RegimeBadge() {
  const [regime, setRegime] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/regime')
      .then(r => r.json())
      .then(d => {
        if (d.success) setRegime(d.data.regime);
      })
      .catch(() => {});
  }, []);

  if (!regime) return null;

  const info = REGIME_LABELS[regime] || REGIME_LABELS['bull_low_vol'];

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: info.bg, border: `1px solid ${info.color}33`,
      borderRadius: 6, padding: '4px 10px', fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
      color: info.color, letterSpacing: '0.05em',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: info.color }} />
      {info.label}
    </div>
  );
}
