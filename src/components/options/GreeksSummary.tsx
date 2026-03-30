'use client';

import { useState, useEffect } from 'react';
import type { PortfolioGreeks } from '@/lib/options/types';

interface GreeksSummaryProps {
  greeks?: PortfolioGreeks | null;
  loading?: boolean;
}

export default function GreeksSummary({ greeks: propGreeks, loading: propLoading }: GreeksSummaryProps) {
  const [fetchedGreeks, setFetchedGreeks] = useState<PortfolioGreeks | null>(null);
  const [selfLoading, setSelfLoading] = useState(false);

  // Self-fetch if no greeks prop provided
  useEffect(() => {
    if (propGreeks !== undefined) return;
    setSelfLoading(true);
    fetch('/api/options/positions')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.greeks) setFetchedGreeks(data.greeks);
      })
      .catch(() => {})
      .finally(() => setSelfLoading(false));
  }, [propGreeks]);

  const greeks = propGreeks !== undefined ? propGreeks : fetchedGreeks;
  const loading = propLoading !== undefined ? propLoading : selfLoading;
  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="terminal-card" style={{ height: 80 }}>
            <div style={{ width: '60%', height: 10, background: '#2a2a3a', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: '40%', height: 20, background: '#2a2a3a', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!greeks) return null;

  const gammaLevel = Math.abs(greeks.netGamma) < 0.05 ? 'Low' : Math.abs(greeks.netGamma) < 0.15 ? 'Moderate' : 'High';
  const gammaColor = gammaLevel === 'Low' ? '#4ade80' : gammaLevel === 'Moderate' ? '#f59e0b' : '#ef4444';
  const vegaLabel = greeks.netVega >= 0 ? 'Long vol' : 'Short vol';

  const cards = [
    {
      label: 'Net Delta',
      value: (greeks.netDelta >= 0 ? '+' : '') + greeks.netDelta.toFixed(2),
      sub: `≈ ${Math.abs(greeks.sharesEquivalent)} shares`,
      color: greeks.netDelta >= 0 ? '#4ade80' : '#ef4444',
    },
    {
      label: 'Daily Theta',
      value: (greeks.netTheta >= 0 ? '+' : '') + '$' + greeks.netTheta.toFixed(2),
      sub: `$${Math.abs(greeks.monthlyTheta).toFixed(0)}/mo`,
      color: greeks.netTheta >= 0 ? '#4ade80' : '#ef4444',
    },
    {
      label: 'Gamma Risk',
      value: (greeks.netGamma >= 0 ? '+' : '') + greeks.netGamma.toFixed(3),
      sub: gammaLevel,
      color: gammaColor,
    },
    {
      label: 'Vega Exp.',
      value: (greeks.netVega >= 0 ? '+' : '') + greeks.netVega.toFixed(2),
      sub: vegaLabel,
      color: greeks.netVega >= 0 ? '#8a5cf6' : '#f59e0b',
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
      {cards.map(card => (
        <div key={card.label} className="terminal-card">
          <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>{card.label}</div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: card.color,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {card.value}
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{card.sub}</div>
        </div>
      ))}
    </div>
  );
}
