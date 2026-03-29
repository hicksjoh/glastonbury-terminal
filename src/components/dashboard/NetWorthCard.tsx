import { Portfolio } from '@/types';

function formatCurrency(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  return `$${(n / 1000).toFixed(0)}K`;
}

const TARGET = 50000000;

export function NetWorthCard({ portfolio }: { portfolio: Portfolio }) {
  const progress = (portfolio.totalNetWorth / TARGET) * 100;
  const items = [
    { label: 'Investment Portfolio', value: portfolio.alpacaEquity + portfolio.alpacaCash, color: '#c9a84c' },
    { label: 'CR3 Franchise Equity', value: portfolio.cr3Equity, color: '#22c55e' },
    { label: 'Anthropic RSUs', value: portfolio.anthropicRSUs, color: '#818cf8' },
    { label: 'Miami Shores', value: portfolio.miamiShoresProperty, color: '#38bdf8' },
  ];

  return (
    <div className="terminal-card gold-glow" style={{ border: '1px solid rgba(201,168,76,0.3)' }}>
      <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Total Net Worth</div>
      <div className="metric-value" style={{ marginBottom: 4 }}>{formatCurrency(portfolio.totalNetWorth)}</div>
      <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 24 }}>
        {progress.toFixed(2)}% toward $50M target
      </div>
      {/* Progress Bar */}
      <div style={{ backgroundColor: '#2a2a3a', borderRadius: 4, height: 6, marginBottom: 24 }}>
        <div style={{
          width: `${Math.min(progress, 100)}%`,
          height: '100%',
          backgroundColor: '#c9a84c',
          borderRadius: 4,
          transition: 'width 0.5s ease',
        }} />
      </div>
      {/* Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {items.map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: '#6b6b80', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{formatCurrency(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
