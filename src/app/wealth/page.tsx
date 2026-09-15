'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import { TrendingUp, TrendingDown, DollarSign, Percent, Building2, Home, Briefcase, Banknote } from 'lucide-react';
import { DataAge } from '@/components/ui/DataAge';

interface WealthData {
  total_net_worth: number;
  total_assets: number;
  /** null when liabilities are not tracked — see `liabilities_tracked`. */
  liabilities: number | null;
  liabilities_tracked?: boolean;
  /** false when a source (currently only the brokerage) failed to resolve. */
  complete?: boolean;
  trading_mode?: 'paper' | 'live';
  simulated_equity_excluded?: number;
  liquidity_ratio: number;
  breakdown: {
    investments: { value: number; positions: number; simulated?: boolean; unavailable?: boolean };
    franchise: { value: number; cost_basis: number };
    real_estate: { value: number; cost_basis: number };
    rsus: { value: number; details: { name: string; current_value: number }[] };
    cash: { value: number };
  };
  assets: { id: string; asset_class: string; name: string; current_value: number; cost_basis: number; last_updated?: string | null }[];
}

function formatCurrency(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

/** A single inline data-quality caveat. Warn = known limitation, bad = failure. */
function Caveat({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  const c = tone === 'bad'
    ? { fg: '#f87171', bg: 'rgba(248,113,113,0.10)', bd: 'rgba(248,113,113,0.30)' }
    : { fg: '#f0c674', bg: 'rgba(240,198,116,0.08)', bd: 'rgba(240,198,116,0.25)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 6,
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, fontSize: 12, lineHeight: 1.4,
    }}>
      {children}
    </span>
  );
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
      borderRadius: 14, padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

const ASSET_COLORS: Record<string, string> = {
  investments: '#8a5cf6',
  franchise: '#4ade80',
  real_estate: '#22d3ee',
  rsus: '#f0c674',
  cash: '#8888a8',
};

const ASSET_ICONS: Record<string, typeof DollarSign> = {
  investments: TrendingUp,
  franchise: Building2,
  real_estate: Home,
  rsus: Briefcase,
  cash: Banknote,
};

export default function WealthPage() {
  const [data, setData] = useState<WealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Wealth | Glastonbury Terminal'; }, []);

  useEffect(() => {
    fetch('/api/wealth')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell>
        <LoadingState variant="mixed" rows={3} cols={3} />
      </AppShell>
    );
  }

  const b = data?.breakdown;
  const total = data?.total_net_worth || 0;

  // Most recent valuation date across the manually-maintained asset rows.
  // These are hand-entered marks that can sit untouched for months, so the
  // page shows how old the newest one is rather than implying live values.
  const newestAssetTs = (data?.assets || [])
    .map(a => a.last_updated)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .sort()
    .pop() ?? null;

  const assetClasses = [
    { key: 'investments', label: 'Investment Portfolio', value: b?.investments.value || 0, costBasis: 0 },
    { key: 'franchise', label: 'CR3 Franchise Equity', value: b?.franchise.value || 0, costBasis: b?.franchise.cost_basis || 0 },
    { key: 'real_estate', label: 'Miami Shores RE', value: b?.real_estate.value || 0, costBasis: b?.real_estate.cost_basis || 0 },
    { key: 'rsus', label: 'Anthropic RSUs', value: b?.rsus.value || 0, costBasis: 0 },
    { key: 'cash', label: 'Cash & Equivalents', value: b?.cash.value || 0, costBasis: b?.cash.value || 0 },
  ];

  // Simple donut chart using CSS conic-gradient
  const segments = assetClasses.filter(a => a.value > 0);
  let cumPct = 0;
  const gradientParts = segments.map(a => {
    const pct = total > 0 ? (a.value / total) * 100 : 0;
    const start = cumPct;
    cumPct += pct;
    return `${ASSET_COLORS[a.key]} ${start}% ${cumPct}%`;
  });
  const conicGradient = `conic-gradient(${gradientParts.join(', ')})`;

  return (
    <ErrorBoundary label="Wealth">
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Total Wealth</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 12px' }}>
          Tracked asset classes{data?.liabilities_tracked === false ? ' · liabilities not tracked' : ''}
        </p>

        {/* Honesty strip. The page used to promise a "complete financial
            picture" while silently counting paper-trading money as real and
            assuming zero debt. Each caveat that actually applies is stated. */}
        {data && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {data.liabilities_tracked === false && (
              <Caveat tone="warn">
                Gross assets — no liabilities recorded, so any mortgage or loan is not subtracted
              </Caveat>
            )}
            {data.breakdown?.investments?.simulated && (
              <Caveat tone="warn">
                Paper trading: {formatCurrency(data.simulated_equity_excluded || 0)} of simulated
                brokerage equity is excluded from this total
              </Caveat>
            )}
            {data.breakdown?.investments?.unavailable && (
              <Caveat tone="bad">Brokerage unreachable — this total is partial</Caveat>
            )}
            {newestAssetTs && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#555570', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  valued
                </span>
                <DataAge ts={newestAssetTs} warnAfterMs={30 * 24 * 3600_000} staleAfterMs={90 * 24 * 3600_000} />
              </span>
            )}
          </div>
        )}

        {/* Top Row — Big Numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          <GlassCard>
            <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
              Total Net Worth
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
              {formatCurrency(total)}
            </div>
          </GlassCard>
          <GlassCard>
            <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
              YTD Change
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace", display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={24} />
              +$0
            </div>
            <div style={{ color: '#555570', fontSize: 12, marginTop: 4 }}>Connect data sources to track</div>
          </GlassCard>
          <GlassCard>
            <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
              Liquidity Ratio
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#22d3ee', fontFamily: "'JetBrains Mono', monospace", display: 'flex', alignItems: 'center', gap: 8 }}>
              <Percent size={24} />
              {((data?.liquidity_ratio || 0) * 100).toFixed(1)}%
            </div>
            <div style={{ color: '#555570', fontSize: 12, marginTop: 4 }}>Liquid / Total Assets</div>
          </GlassCard>
        </div>

        {/* Row 2 — Donut + Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, marginBottom: 28 }}>
          <GlassCard style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: 200, height: 200, borderRadius: '50%',
              background: conicGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 120, height: 120, borderRadius: '50%',
                background: '#0a0a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column',
              }}>
                <div style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase' }}>Total</div>
                <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {formatCurrency(total)}
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
              Asset Class Breakdown
            </div>
            {segments.map(a => (
              <div key={a.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: ASSET_COLORS[a.key] }} />
                  <span style={{ color: '#e8e8f0', fontSize: 13 }}>{a.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ color: '#e8e8f0', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                    {formatCurrency(a.value)}
                  </span>
                  <span style={{ color: '#555570', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", width: 45, textAlign: 'right' }}>
                    {total > 0 ? ((a.value / total) * 100).toFixed(1) : '0'}%
                  </span>
                </div>
              </div>
            ))}
          </GlassCard>
        </div>

        {/* Row 3 — Asset Class Performance Cards */}
        <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
          Asset Class Details
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 28 }}>
          {assetClasses.map(a => {
            const Icon = ASSET_ICONS[a.key] || DollarSign;
            const gain = a.costBasis > 0 ? a.value - a.costBasis : 0;
            const gainPct = a.costBasis > 0 ? (gain / a.costBasis * 100) : 0;
            const pctOfTotal = total > 0 ? (a.value / total * 100) : 0;

            return (
              <GlassCard key={a.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `${ASSET_COLORS[a.key]}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={18} color={ASSET_COLORS[a.key]} />
                  </div>
                  <div>
                    <div style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600 }}>{a.label}</div>
                    <div style={{ color: '#555570', fontSize: 11 }}>{pctOfTotal.toFixed(1)}% of total</div>
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                  {formatCurrency(a.value)}
                </div>
                {a.costBasis > 0 && (
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    <span style={{ color: '#8888a8' }}>Cost: {formatCurrency(a.costBasis)}</span>
                    <span style={{ color: gain >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {gain >= 0 ? '+' : ''}{formatCurrency(gain)} ({gainPct.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>

        {/* Keisha Insight */}
        <GlassCard style={{ borderColor: '#f0c67433', background: 'rgba(240,198,116,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#f0c674', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace" }}>
              Keisha Insight
            </div>
          </div>
          <div style={{ color: '#e8e8f0', fontSize: 13, lineHeight: 1.6 }}>
            {total > 0
              ? `Your portfolio is ${((b?.franchise.value || 0) / total * 100).toFixed(1)}% franchise equity — a strong wealth engine but illiquid. As CR3 territories are sold, consider diversifying proceeds into liquid assets. The Anthropic RSUs at ${((b?.rsus.value || 0) / total * 100).toFixed(1)}% of net worth add concentration risk — watch the vesting schedule and diversify on each quarterly vest.`
              : 'Connect your data sources to see personalized wealth insights from Keisha.'
            }
          </div>
        </GlassCard>
      </div>
    </AppShell>
    </ErrorBoundary>
  );
}
