'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AlertTriangle, TrendingUp, TrendingDown, Wallet, Clock } from 'lucide-react';

interface MonthData {
  month: string;
  inflows: number;
  outflows: number;
  net: number;
  balance: number;
}

interface CashflowData {
  current_cash: number;
  monthly_burn_rate: number;
  runway_months: number;
  total_inflows_12m: number;
  total_outflows_12m: number;
  months: MonthData[];
  cash_crunch: { month: string; balance: number } | null;
}

function formatCurrency(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Scenario = 'base' | 'optimistic' | 'conservative';

export default function CashflowPage() {
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scenario, setScenario] = useState<Scenario>('base');

  useEffect(() => {
    fetch('/api/cashflow')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const scenarioMultiplier = scenario === 'optimistic' ? 1.2 : scenario === 'conservative' ? 0.8 : 1;

  const adjustedMonths = data?.months.map(m => ({
    ...m,
    inflows: m.inflows * scenarioMultiplier,
    outflows: m.outflows * (scenario === 'conservative' ? 1.1 : scenario === 'optimistic' ? 0.9 : 1),
    net: m.inflows * scenarioMultiplier - m.outflows * (scenario === 'conservative' ? 1.1 : scenario === 'optimistic' ? 0.9 : 1),
  })) || [];

  // Recalculate running balance
  let runBal = data?.current_cash || 0;
  const balanceMonths = adjustedMonths.map(m => {
    runBal += m.net;
    return { ...m, balance: runBal };
  });

  const maxVal = Math.max(...balanceMonths.map(m => Math.max(m.inflows, m.outflows, m.balance)), 1);

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Cash Flow Forecaster</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>12-month forward projection</p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Loading cash flow data...</div>
        ) : (
          <>
            {/* Warning Banner */}
            {data?.cash_crunch && (
              <div style={{
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 20,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <AlertTriangle size={16} color="#f87171" />
                <span style={{ color: '#f87171', fontSize: 13, fontWeight: 500 }}>
                  Cash crunch projected in {data.cash_crunch.month} — balance drops to {formatCurrency(data.cash_crunch.balance)}
                </span>
              </div>
            )}

            {/* Top Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
              {[
                { label: 'Current Cash', value: data?.current_cash || 0, icon: Wallet, color: '#4ade80' },
                { label: 'Monthly Burn Rate', value: data?.monthly_burn_rate || 0, icon: TrendingDown, color: '#f87171' },
                { label: 'Runway', value: data?.runway_months || 0, icon: Clock, color: '#22d3ee', format: (v: number) => `${v} months` },
                { label: '12M Net Cash Flow', value: (data?.total_inflows_12m || 0) - (data?.total_outflows_12m || 0), icon: TrendingUp, color: '#8a5cf6' },
              ].map((card) => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
                  borderRadius: 14, padding: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <card.icon size={14} color={card.color} />
                    <span style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace" }}>
                      {card.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
                    {card.format ? card.format(card.value) : formatCurrency(card.value)}
                  </div>
                </div>
              ))}
            </div>

            {/* Scenario Toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {(['base', 'optimistic', 'conservative'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScenario(s)}
                  style={{
                    background: scenario === s ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${scenario === s ? '#8a5cf6' : '#1e1e35'}`,
                    borderRadius: 8, padding: '8px 16px', cursor: 'pointer',
                    color: scenario === s ? '#8a5cf6' : '#8888a8', fontSize: 12, fontWeight: 500,
                    textTransform: 'capitalize',
                  }}
                >
                  {s === 'base' ? 'Base Case' : s === 'optimistic' ? 'Optimistic (+20%)' : 'Conservative (-20%)'}
                </button>
              ))}
            </div>

            {/* Waterfall Chart (simplified bar chart) */}
            <div style={{
              background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35',
              padding: 24, marginBottom: 24,
            }}>
              <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 20, fontFamily: "'JetBrains Mono', monospace" }}>
                Monthly Cash Flow Waterfall
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 200 }}>
                {balanceMonths.map((m, i) => {
                  const inflowH = maxVal > 0 ? (m.inflows / maxVal) * 180 : 0;
                  const outflowH = maxVal > 0 ? (m.outflows / maxVal) * 180 : 0;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 180 }}>
                        <div style={{
                          width: 14, height: Math.max(inflowH, 2), background: '#4ade80',
                          borderRadius: '3px 3px 0 0', opacity: 0.8,
                        }} />
                        <div style={{
                          width: 14, height: Math.max(outflowH, 2), background: '#f87171',
                          borderRadius: '3px 3px 0 0', opacity: 0.8,
                        }} />
                      </div>
                      <div style={{ color: '#555570', fontSize: 9, fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                        {m.month.split(' ')[0]}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: '#4ade80' }} />
                  <span style={{ color: '#8888a8', fontSize: 11 }}>Inflows</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: '#f87171' }} />
                  <span style={{ color: '#8888a8', fontSize: 11 }}>Outflows</span>
                </div>
              </div>
            </div>

            {/* Monthly Detail Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                    {['Month', 'Inflows', 'Outflows', 'Net', 'Balance'].map(h => (
                      <th key={h} style={{
                        textAlign: h === 'Month' ? 'left' : 'right', padding: '12px 16px',
                        fontSize: 11, color: '#555570', textTransform: 'uppercase', letterSpacing: '0.05em',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {balanceMonths.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                      <td style={{ padding: '12px 16px', color: '#e8e8f0', fontSize: 13 }}>{m.month}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                        +{formatCurrency(m.inflows)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#f87171', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                        -{formatCurrency(m.outflows)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: m.net >= 0 ? '#4ade80' : '#f87171' }}>
                        {m.net >= 0 ? '+' : ''}{formatCurrency(m.net)}
                      </td>
                      <td style={{
                        padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                        fontWeight: 600, color: m.balance < 25000 ? '#f87171' : '#e8e8f0',
                      }}>
                        {formatCurrency(m.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Keisha Insight */}
            <div style={{
              marginTop: 24, background: 'rgba(240,198,116,0.03)', border: '1px solid rgba(240,198,116,0.15)',
              borderRadius: 14, padding: 20,
            }}>
              <div style={{ color: '#f0c674', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                Keisha Insight
              </div>
              <div style={{ color: '#e8e8f0', fontSize: 13, lineHeight: 1.6 }}>
                Your Q3 RSU vest of ~$373K arrives in July. Consider deploying $100K into covered calls for premium income and holding $273K for your estimated Q3 tax payment. Add cash flow items via the Supabase dashboard to see your full projection.
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
