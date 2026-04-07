'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import { Plus, Filter, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Target, Award, BarChart3, Download } from 'lucide-react';
import { exportToCSV, exportToPDF } from '@/lib/export';

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

interface JournalAnalytics {
  overview: { totalTrades: number; winRate: number; expectancy: number; sharpeRatio: number; profitFactor: number };
  byStrategy: { strategy: string; trades: number; winRate: number; avgReturn: number; totalPnl: number }[];
  byTimeOfDay: { hour: number; trades: number; winRate: number }[];
  byDayOfWeek: { day: string; trades: number; winRate: number }[];
  holdTime: { avgWinner: number; avgLoser: number };
  streaks: { maxWin: number; maxLoss: number; current: number };
  monthlyPnl: { month: string; pnl: number; trades: number }[];
  keishaAccuracy: { agreed: number; disagreed: number; agreedAndRight: number; disagreedAndRight: number };
  bestTrade: Record<string, unknown> | null;
  worstTrade: Record<string, unknown> | null;
  recentPerformance: { last10Trades: Record<string, unknown>[]; last30DaysPnl: number };
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

  const [tab, setTab] = useState<'journal' | 'analytics'>('journal');
  const [analytics, setAnalytics] = useState<JournalAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (tab === 'analytics' && !analytics) {
      setAnalyticsLoading(true);
      fetch('/api/journal-analytics')
        .then(r => r.json())
        .then(d => { if (!d.error) setAnalytics(d); })
        .catch(() => {})
        .finally(() => setAnalyticsLoading(false));
    }
  }, [tab, analytics]);

  const strategies = ['all', 'wheel', 'dip_buy', 'earnings', 'momentum', 'custom'];

  return (
    <AppShell>
      <ErrorBoundary label="Journal">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Trade Journal</h1>
            <p style={{ color: '#8888a8', fontSize: 14, margin: 0 }}>Track, analyze, and improve your trading</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['journal', 'analytics'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
                fontWeight: tab === t ? 600 : 400,
                border: `1px solid ${tab === t ? (t === 'analytics' ? '#22d3ee' : '#8a5cf6') : '#1e1e35'}`,
                background: tab === t ? (t === 'analytics' ? 'rgba(34,211,238,0.1)' : 'rgba(138,92,246,0.1)') : 'rgba(255,255,255,0.03)',
                color: tab === t ? (t === 'analytics' ? '#22d3ee' : '#8a5cf6') : '#888',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {t === 'analytics' && <BarChart3 size={13} />}
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => {
                if (trades.length === 0) return;
                exportToCSV(trades.map(t => ({
                  date: t.entry_date,
                  symbol: t.ticker,
                  direction: t.direction,
                  entry_price: t.entry_price,
                  exit_price: t.exit_price ?? '',
                  pnl: t.pnl ?? '',
                  notes: t.notes ?? '',
                  tags: (t.tags || []).join('; '),
                  strategy: t.strategy ?? '',
                })), 'trade-journal');
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid #333350', color: '#8888a8', fontSize: 11, fontWeight: 500,
              }}
            >
              <Download size={12} /> CSV
            </button>
            <button
              onClick={() => {
                if (trades.length === 0) return;
                const rows = trades.map(t =>
                  `<tr>
                    <td>${t.entry_date}</td><td>${t.ticker}</td><td>${t.direction}</td>
                    <td>${t.strategy || '-'}</td><td>$${Number(t.entry_price).toFixed(2)}</td>
                    <td>${t.exit_price ? '$' + Number(t.exit_price).toFixed(2) : 'Open'}</td>
                    <td class="${(t.pnl || 0) >= 0 ? 'positive' : 'negative'}">${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + '$' + Number(t.pnl).toFixed(2) : '-'}</td>
                  </tr>`
                ).join('');
                exportToPDF('Trade Journal Report',
                  `<table><thead><tr><th>Date</th><th>Symbol</th><th>Dir</th><th>Strategy</th><th>Entry</th><th>Exit</th><th>P&L</th></tr></thead><tbody>${rows}</tbody></table>`,
                  'trade-journal');
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid #333350', color: '#8888a8', fontSize: 11, fontWeight: 500,
              }}
            >
              <Download size={12} /> PDF
            </button>
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
        </div>

        {tab === 'analytics' ? (
          /* Analytics Tab */
          analyticsLoading ? (
            <LoadingState />
          ) : !analytics ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#555' }}>No analytics data available. Add trades to your journal first.</div>
          ) : (
            <>
              {/* Overview Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 24 }}>
                {[
                  { label: 'Total Trades', value: analytics.overview.totalTrades, color: '#8a5cf6' },
                  { label: 'Win Rate', value: `${analytics.overview.winRate}%`, color: analytics.overview.winRate >= 50 ? '#4ade80' : '#f87171' },
                  { label: 'Expectancy', value: formatCurrency(analytics.overview.expectancy), color: analytics.overview.expectancy >= 0 ? '#4ade80' : '#f87171' },
                  { label: 'Sharpe Ratio', value: analytics.overview.sharpeRatio.toFixed(3), color: analytics.overview.sharpeRatio >= 1 ? '#4ade80' : '#f0c674' },
                  { label: 'Profit Factor', value: analytics.overview.profitFactor.toFixed(2), color: analytics.overview.profitFactor >= 1.5 ? '#4ade80' : '#f0c674' },
                ].map(card => (
                  <div key={card.label} style={{
                    background: `${card.color}08`, border: `1px solid ${card.color}20`,
                    borderRadius: 12, padding: 14,
                  }}>
                    <div style={{ color: '#888', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{card.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: card.color, fontFamily: "'JetBrains Mono', monospace" }}>{card.value}</div>
                  </div>
                ))}
              </div>

              {/* Monthly P&L Calendar Heatmap */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>Monthly P&amp;L</h3>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {analytics.monthlyPnl.map(m => (
                    <div key={m.month} style={{
                      padding: '8px 12px', borderRadius: 6, minWidth: 80, textAlign: 'center',
                      background: m.pnl >= 0 ? `rgba(74,222,128,${Math.min(0.3, Math.abs(m.pnl) / 5000)})` : `rgba(248,113,113,${Math.min(0.3, Math.abs(m.pnl) / 5000)})`,
                      border: `1px solid ${m.pnl >= 0 ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                    }}>
                      <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{m.month}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: m.pnl >= 0 ? '#4ade80' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
                        {formatCurrency(m.pnl)}
                      </div>
                      <div style={{ fontSize: 9, color: '#555' }}>{m.trades} trades</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Strategy Performance */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 20 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>Strategy Performance</h3>
                  {analytics.byStrategy.map(s => (
                    <div key={s.strategy} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: '#ccc', fontSize: 12, textTransform: 'capitalize' }}>{s.strategy.replace('_', ' ')}</span>
                        <span style={{ color: s.winRate >= 50 ? '#4ade80' : '#f87171', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{s.winRate}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${s.winRate}%`, background: s.winRate >= 50 ? '#4ade80' : '#f87171', transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: '#555' }}>{s.trades} trades</span>
                        <span style={{ fontSize: 10, color: s.totalPnl >= 0 ? '#4ade80' : '#f87171' }}>{formatCurrency(s.totalPnl)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Keisha Accuracy */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 20 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>Keisha Accuracy</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.keishaAccuracy.agreed}</div>
                      <div style={{ fontSize: 10, color: '#888' }}>Agreed</div>
                    </div>
                    <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.keishaAccuracy.disagreed}</div>
                      <div style={{ fontSize: 10, color: '#888' }}>Disagreed</div>
                    </div>
                    <div style={{ background: 'rgba(240,198,116,0.08)', border: '1px solid rgba(240,198,116,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#f0c674', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.keishaAccuracy.agreedAndRight}</div>
                      <div style={{ fontSize: 10, color: '#888' }}>Agreed &amp; Right</div>
                    </div>
                    <div style={{ background: 'rgba(138,92,246,0.08)', border: '1px solid rgba(138,92,246,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#8a5cf6', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.keishaAccuracy.disagreedAndRight}</div>
                      <div style={{ fontSize: 10, color: '#888' }}>Disagreed &amp; Right</div>
                    </div>
                  </div>

                  {/* Streaks */}
                  <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.streaks.maxWin}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>Max Win Streak</div>
                    </div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{analytics.streaks.maxLoss}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>Max Loss Streak</div>
                    </div>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{
                        fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                        color: analytics.streaks.current > 0 ? '#4ade80' : analytics.streaks.current < 0 ? '#f87171' : '#888',
                      }}>{analytics.streaks.current}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>Current Streak</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Day of Week Performance */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35', borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px' }}>Performance by Day of Week</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  {analytics.byDayOfWeek.map(d => (
                    <div key={d.day} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{
                        height: 60, borderRadius: 6, marginBottom: 6,
                        background: d.winRate >= 50 ? `rgba(74,222,128,${0.1 + d.winRate / 200})` : `rgba(248,113,113,${0.1 + (100 - d.winRate) / 200})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: d.winRate >= 50 ? '#4ade80' : '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>{d.winRate}%</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#888' }}>{d.day.slice(0, 3)}</div>
                      <div style={{ fontSize: 9, color: '#555' }}>{d.trades} trades</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        ) : loading ? (
          <LoadingState />
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
      </ErrorBoundary>
    </AppShell>
  );
}
