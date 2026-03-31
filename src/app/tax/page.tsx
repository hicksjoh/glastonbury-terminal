'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Receipt, AlertTriangle, TrendingDown, TrendingUp, Shield, Calculator } from 'lucide-react';

interface TaxData {
  ytd_short_term_gains: number;
  ytd_long_term_gains: number;
  ytd_harvested_losses: number;
  ytd_dividend_income: number;
  ytd_royalty_income: number;
  ytd_rsu_vests: number;
  qbi_deduction: number;
  estimated_quarterly_liability: number;
  estimated_annual_liability: number;
  federal_rate: number;
  state_rate: number;
  niit_rate: number;
  wash_sales: { ticker: string; date: string; wash_sale_expires: string; amount: number }[];
  events: { id: string; event_type: string; tax_character: string; amount: number; ticker: string; description: string; date: string; wash_sale_flag: boolean }[];
}

function formatCurrency(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function TaxPage() {
  const [data, setData] = useState<TaxData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tax')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const currentYear = new Date().getFullYear();

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Tax Command Center</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>{currentYear} Tax Intelligence</p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Loading tax data...</div>
        ) : (
          <>
            {/* Top Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 28 }}>
              {[
                { label: 'Est. Q2 Tax', value: data?.estimated_quarterly_liability || 0, icon: Receipt, color: '#f87171' },
                { label: 'YTD Short-Term', value: data?.ytd_short_term_gains || 0, icon: TrendingUp, color: '#f0c674' },
                { label: 'YTD Long-Term', value: data?.ytd_long_term_gains || 0, icon: TrendingUp, color: '#4ade80' },
                { label: 'Harvested Losses', value: data?.ytd_harvested_losses || 0, icon: Shield, color: '#22d3ee' },
                { label: 'QBI Deduction', value: data?.qbi_deduction || 0, icon: Calculator, color: '#8a5cf6' },
              ].map(card => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
                  borderRadius: 14, padding: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <card.icon size={12} color={card.color} />
                    <span style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>
                      {card.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
                    {formatCurrency(card.value)}
                  </div>
                </div>
              ))}
            </div>

            {/* Tax Bracket Reference */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 20 }}>
                <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                  Current Marginal Rates
                </div>
                {[
                  { label: 'Federal', rate: (data?.federal_rate || 0) * 100, color: '#f87171' },
                  { label: 'CA State', rate: (data?.state_rate || 0) * 100, color: '#f0c674' },
                  { label: 'NIIT', rate: (data?.niit_rate || 0) * 100, color: '#8a5cf6' },
                  { label: 'Combined', rate: ((data?.federal_rate || 0) + (data?.state_rate || 0) + (data?.niit_rate || 0)) * 100, color: '#22d3ee' },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                    <span style={{ color: '#8888a8', fontSize: 13 }}>{r.label}</span>
                    <span style={{ color: r.color, fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                      {r.rate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* Wash Sale Monitor */}
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', padding: 20 }}>
                <div style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                  Wash Sale Monitor
                </div>
                {(data?.wash_sales || []).length === 0 ? (
                  <div style={{ color: '#4ade80', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Shield size={14} />
                    No active wash sale restrictions
                  </div>
                ) : (
                  data?.wash_sales.map((ws, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                      <div>
                        <span style={{ color: '#f87171', fontWeight: 600, fontSize: 13 }}>{ws.ticker}</span>
                        <span style={{ color: '#555570', fontSize: 11, marginLeft: 8 }}>sold {ws.date}</span>
                      </div>
                      <span style={{ color: '#f87171', fontSize: 11 }}>
                        <AlertTriangle size={10} /> Restricted until {ws.wash_sale_expires}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Tax Events Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e1e35' }}>
                <span style={{ color: '#8a5cf6', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  YTD Tax Events
                </span>
              </div>
              {(data?.events || []).length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#555570', fontSize: 13 }}>
                  No tax events recorded for {currentYear}. As trades are executed, events will appear here.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                      {['Date', 'Type', 'Ticker', 'Amount', 'Character', 'Wash Sale'].map(h => (
                        <th key={h} style={{
                          textAlign: h === 'Amount' ? 'right' : 'left', padding: '10px 14px',
                          fontSize: 11, color: '#555570', textTransform: 'uppercase', letterSpacing: '0.05em',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.events.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid rgba(30,30,53,0.5)' }}>
                        <td style={{ padding: '10px 14px', color: '#8888a8', fontSize: 12 }}>{e.date}</td>
                        <td style={{ padding: '10px 14px', color: '#e8e8f0', fontSize: 12, textTransform: 'capitalize' }}>
                          {e.event_type.replace(/_/g, ' ')}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#e8e8f0', fontWeight: 600, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                          {e.ticker || '-'}
                        </td>
                        <td style={{
                          padding: '10px 14px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                          color: e.event_type.includes('loss') ? '#f87171' : '#4ade80', fontWeight: 600,
                        }}>
                          {formatCurrency(Math.abs(Number(e.amount)))}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#8888a8', fontSize: 11, textTransform: 'capitalize' }}>
                          {e.tax_character?.replace(/_/g, ' ') || '-'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {e.wash_sale_flag ? <AlertTriangle size={12} color="#f87171" /> : <span style={{ color: '#4ade80', fontSize: 12 }}>Clear</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* RSU Tax Optimizer placeholder */}
            <div style={{
              marginTop: 24, background: 'rgba(240,198,116,0.03)', border: '1px solid rgba(240,198,116,0.15)',
              borderRadius: 14, padding: 20,
            }}>
              <div style={{ color: '#f0c674', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                RSU Tax Optimizer
              </div>
              <div style={{ color: '#e8e8f0', fontSize: 13, lineHeight: 1.6 }}>
                5,749 Anthropic RSUs with quarterly vesting. At current estimated valuation, each vest creates ~$373K in ordinary income.
                The optimal strategy is to sell 50% on vest and diversify, holding the remainder for long-term capital gains treatment after 1 year.
                Your combined marginal rate on RSU income is approximately {(((data?.federal_rate || 0) + (data?.state_rate || 0) + (data?.niit_rate || 0)) * 100).toFixed(1)}%.
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
