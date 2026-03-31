'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Plus, Filter, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Target, Award } from 'lucide-react';

interface Trade {
  id: string;
  ticker: string;
  direction: string;
  strategy: string;
  entry_date: string;
  entry_price: number;
  exit_date: string | null;
  exit_price: number | null;
  quantity: number;
  pnl: number | null;
  pnl_percent: number | null;
  entry_thesis: string | null;
  exit_thesis: string | null;
  keisha_agreed: boolean | null;
  keisha_recommendation: string | null;
  notes: string | null;
  tags: string[];
}

interface JournalStats {
  total_trades: number;
  win_rate: string;
  avg_pnl: number;
  best_trade: Trade | null;
  worst_trade: Trade | null;
  total_pnl: number;
  keisha_override_count: number;
}

function formatCurrency(n: number) {
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStrategy, setFilterStrategy] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const params = filterStrategy !== 'all' ? `?strategy=${filterStrategy}` : '';
    fetch(`/api/journal${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTrades(d.data.trades);
          setStats(d.data.stats);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterStrategy]);

  const strategies = ['all', 'wheel', 'dip_buy', 'earnings', 'momentum', 'custom'];

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Trade Journal</h1>
            <p style={{ color: '#8888a8', fontSize: 14, margin: 0 }}>Track, analyze, and improve your trading</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: '#8a5cf6', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            <Plus size={16} /> New Trade
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555570' }}>Loading journal...</div>
        ) : (
          <>
            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24 }}>
              {[
                { label: 'Total Trades', value: stats?.total_trades || 0, icon: Target, color: '#8a5cf6' },
                { label: 'Win Rate', value: `${stats?.win_rate || 0}%`, icon: Award, color: '#4ade80' },
                { label: 'Avg P&L', value: formatCurrency(stats?.avg_pnl || 0), icon: TrendingUp, color: (stats?.avg_pnl || 0) >= 0 ? '#4ade80' : '#f87171' },
                { label: 'Total P&L', value: formatCurrency(stats?.total_pnl || 0), icon: TrendingUp, color: (stats?.total_pnl || 0) >= 0 ? '#4ade80' : '#f87171' },
                { label: 'Best Trade', value: stats?.best_trade ? formatCurrency(Number(stats.best_trade.pnl || 0)) : '$0', icon: TrendingUp, color: '#4ade80' },
                { label: 'Keisha Overrides', value: stats?.keisha_override_count || 0, icon: Target, color: '#f0c674' },
              ].map(card => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
                  borderRadius: 12, padding: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <card.icon size={12} color={card.color} />
                    <span style={{ color: '#8888a8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>
                      {card.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: card.color, fontFamily: "'JetBrains Mono', monospace" }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Strategy Filters */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              <Filter size={14} color="#555570" style={{ marginTop: 7 }} />
              {strategies.map(s => (
                <button
                  key={s}
                  onClick={() => { setFilterStrategy(s); setLoading(true); }}
                  style={{
                    padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                    textTransform: 'capitalize',
                    background: filterStrategy === s ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${filterStrategy === s ? '#8a5cf6' : '#1e1e35'}`,
                    color: filterStrategy === s ? '#8a5cf6' : '#8888a8',
                  }}
                >
                  {s === 'all' ? 'All' : s.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Trades Table */}
            {trades.length === 0 ? (
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
                borderRadius: 12, padding: 48, textAlign: 'center', color: '#555570', fontSize: 13,
              }}>
                No trades recorded yet. Click &ldquo;New Trade&rdquo; to add your first journal entry.
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                      {['Date', 'Ticker', 'Dir', 'Strategy', 'Entry', 'Exit', 'P&L', 'P&L%', 'Keisha'].map(h => (
                        <th key={h} style={{
                          textAlign: h === 'P&L' || h === 'P&L%' ? 'right' : 'left',
                          padding: '10px 12px', fontSize: 11, color: '#555570',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <>
                        <tr
                          key={t.id}
                          onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                          style={{ borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer' }}
                        >
                          <td style={{ padding: '10px 12px', color: '#8888a8', fontSize: 12 }}>{t.entry_date}</td>
                          <td style={{ padding: '10px 12px', color: '#e8e8f0', fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{t.ticker}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{
                              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
                              background: t.direction === 'long' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                              color: t.direction === 'long' ? '#4ade80' : '#f87171',
                            }}>{t.direction}</span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#8888a8', fontSize: 12, textTransform: 'capitalize' }}>{t.strategy?.replace('_', ' ') || '-'}</td>
                          <td style={{ padding: '10px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#e8e8f0' }}>${Number(t.entry_price).toFixed(2)}</td>
                          <td style={{ padding: '10px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#e8e8f0' }}>{t.exit_price ? `$${Number(t.exit_price).toFixed(2)}` : 'Open'}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: (t.pnl || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                            {t.pnl != null ? formatCurrency(Number(t.pnl)) : '-'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: (t.pnl_percent || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                            {t.pnl_percent != null ? `${Number(t.pnl_percent).toFixed(1)}%` : '-'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {t.keisha_agreed === true && <span style={{ color: '#4ade80', fontSize: 11 }}>Agreed</span>}
                            {t.keisha_agreed === false && <span style={{ color: '#f87171', fontSize: 11 }}>Overridden</span>}
                            {t.keisha_agreed == null && <span style={{ color: '#555570', fontSize: 11 }}>-</span>}
                          </td>
                        </tr>
                        {expandedId === t.id && (
                          <tr key={`${t.id}-detail`}>
                            <td colSpan={9} style={{ padding: '12px 20px', background: 'rgba(138,92,246,0.03)', borderBottom: '1px solid #1e1e35' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 12 }}>
                                <div>
                                  <div style={{ color: '#8a5cf6', fontSize: 10, textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Entry Thesis</div>
                                  <div style={{ color: '#e8e8f0' }}>{t.entry_thesis || 'No thesis recorded'}</div>
                                </div>
                                <div>
                                  <div style={{ color: '#8a5cf6', fontSize: 10, textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Exit Thesis</div>
                                  <div style={{ color: '#e8e8f0' }}>{t.exit_thesis || 'No exit thesis'}</div>
                                </div>
                                {t.keisha_recommendation && (
                                  <div style={{ gridColumn: '1/3' }}>
                                    <div style={{ color: '#f0c674', fontSize: 10, textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Keisha Recommendation</div>
                                    <div style={{ color: '#e8e8f0' }}>{t.keisha_recommendation}</div>
                                  </div>
                                )}
                                {t.notes && (
                                  <div style={{ gridColumn: '1/3' }}>
                                    <div style={{ color: '#555570', fontSize: 10, textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>Notes</div>
                                    <div style={{ color: '#8888a8' }}>{t.notes}</div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
