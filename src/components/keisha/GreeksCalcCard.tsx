'use client';

import type { GreeksCalcCardData } from '@/types/keisha';

export function GreeksCalcCard({ data }: { data: GreeksCalcCardData }) {
  const typeColor = data.type === 'call' ? '#4ade80' : '#f87171';
  return (
    <div style={{ padding: 14, marginTop: 8, background: 'rgba(255,255,255,0.03)', border: `2px solid ${typeColor}40`, borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: typeColor, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>
            Greeks · {data.type.toUpperCase()}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
            {data.ticker} ${data.strike} {data.expiry}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            spot ${data.spot.toFixed(2)} · IV {(data.iv * 100).toFixed(1)}% · {data.dte} DTE · theoretical ${data.premium_theoretical.toFixed(2)}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'Δ', value: data.greeks.delta, color: typeColor },
          { label: 'Γ', value: data.greeks.gamma, color: '#8a5cf6' },
          { label: 'Θ', value: data.greeks.theta, color: '#f0c674' },
          { label: 'ν', value: data.greeks.vega, color: '#22d3ee' },
          { label: 'ρ', value: data.greeks.rho, color: '#a78bfa' },
        ].map(g => (
          <div key={g.label} style={{ textAlign: 'center', padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: g.color }}>{g.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace" }}>
              {g.value.toFixed(Math.abs(g.value) >= 1 ? 2 : 4)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GreeksCalcCard;
