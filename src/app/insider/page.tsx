'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Users, ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react';

interface InsiderTrade {
  symbol: string; name: string; title: string; transactionType: string;
  shares: number; pricePerShare: number; totalValue: number; date: string; filingUrl: string;
}

interface CongressTrade {
  symbol: string; representative: string; party: string; chamber: string;
  transactionType: string; amount: string; date: string; disclosureDate: string;
}

interface Signal {
  type: string; symbol: string; description: string; confidence: number; date: string;
}

export default function InsiderPage() {
  const [tab, setTab] = useState<'insider' | 'congress'>('insider');
  const [insiderTrades, setInsiderTrades] = useState<InsiderTrade[]>([]);
  const [congressTrades, setCongressTrades] = useState<CongressTrade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [chamber, setChamber] = useState<'all' | 'senate' | 'house'>('all');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/insider?type=all&days=${days}`)
      .then(r => r.json())
      .then(d => {
        setInsiderTrades(d.insiderTrades || []);
        setCongressTrades(d.congressTrades || []);
        setSignals(d.signals || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const filteredCongress = chamber === 'all'
    ? congressTrades
    : congressTrades.filter(t => t.chamber === chamber);

  return (
    <AppShell>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Users size={24} color="#c9a84c" />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Insider &amp; Congressional Tracker</h1>
        </div>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>SEC Form 4 filings &bull; Senate &amp; House disclosures</p>

        {/* Tabs + Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
          {(['insider', 'congress'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer', textTransform: 'capitalize',
              border: `1px solid ${tab === t ? '#c9a84c' : '#1e1e35'}`,
              background: tab === t ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)',
              color: tab === t ? '#c9a84c' : '#888',
            }}>
              {t === 'insider' ? 'Insider Trades' : 'Congress Trades'}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: '#555', fontSize: 11 }}>PERIOD</span>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${days === d ? '#8a5cf6' : '#1e1e35'}`,
                background: days === d ? 'rgba(138,92,246,0.1)' : 'transparent',
                color: days === d ? '#8a5cf6' : '#666',
              }}>{d}d</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
          {/* Main Content */}
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Loading trades...</div>
            ) : tab === 'insider' ? (
              /* Insider Trades Table */
              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
                {insiderTrades.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: '#555', fontSize: 13 }}>No insider trades found in the last {days} days</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                        {['Symbol', 'Name', 'Title', 'Type', 'Shares', 'Price', 'Value', 'Date'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '10px 10px', fontSize: 10, color: '#555', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {insiderTrades.map((t, i) => (
                        <tr key={i} onClick={() => window.location.href = `/trading?symbol=${t.symbol}`}
                          style={{ borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer', background: t.transactionType === 'buy' ? 'rgba(74,222,128,0.02)' : 'rgba(248,113,113,0.02)' }}>
                          <td style={{ padding: '10px', fontWeight: 700, color: '#e8e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{t.symbol}</td>
                          <td style={{ padding: '10px', color: '#ccc', fontSize: 12, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                          <td style={{ padding: '10px', color: '#888', fontSize: 11, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                          <td style={{ padding: '10px' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                              padding: '2px 8px', borderRadius: 4,
                              background: t.transactionType === 'buy' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                              color: t.transactionType === 'buy' ? '#4ade80' : '#f87171',
                            }}>
                              {t.transactionType === 'buy' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {t.transactionType}
                            </span>
                          </td>
                          <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#ccc' }}>{t.shares.toLocaleString()}</td>
                          <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#ccc' }}>${t.pricePerShare.toFixed(2)}</td>
                          <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#f0c674', fontWeight: 600 }}>
                            ${t.totalValue >= 1000000 ? `${(t.totalValue / 1000000).toFixed(1)}M` : `${(t.totalValue / 1000).toFixed(0)}K`}
                          </td>
                          <td style={{ padding: '10px', color: '#888', fontSize: 12 }}>{t.date?.split('T')[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              /* Congress Trades Table */
              <>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {(['all', 'senate', 'house'] as const).map(c => (
                    <button key={c} onClick={() => setChamber(c)} style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
                      border: `1px solid ${chamber === c ? '#22d3ee' : '#1e1e35'}`,
                      background: chamber === c ? 'rgba(34,211,238,0.1)' : 'transparent',
                      color: chamber === c ? '#22d3ee' : '#666',
                    }}>{c}</button>
                  ))}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
                  {filteredCongress.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#555', fontSize: 13 }}>No congressional trades found</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                          {['Symbol', 'Representative', 'Party', 'Chamber', 'Type', 'Amount', 'Date'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '10px 10px', fontSize: 10, color: '#555', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCongress.map((t, i) => (
                          <tr key={i} onClick={() => window.location.href = `/trading?symbol=${t.symbol}`}
                            style={{ borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer' }}>
                            <td style={{ padding: '10px', fontWeight: 700, color: '#e8e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{t.symbol}</td>
                            <td style={{ padding: '10px', color: '#ccc', fontSize: 12 }}>{t.representative}</td>
                            <td style={{ padding: '10px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                                background: t.party.includes('D') ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)',
                                color: t.party.includes('D') ? '#60a5fa' : '#f87171',
                              }}>{t.party}</span>
                            </td>
                            <td style={{ padding: '10px', color: '#888', fontSize: 12, textTransform: 'capitalize' }}>{t.chamber}</td>
                            <td style={{ padding: '10px' }}>
                              <span style={{
                                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                                color: t.transactionType === 'buy' ? '#4ade80' : '#f87171',
                              }}>{t.transactionType}</span>
                            </td>
                            <td style={{ padding: '10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#f0c674' }}>{t.amount}</td>
                            <td style={{ padding: '10px', color: '#888', fontSize: 12 }}>{t.date?.split('T')[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Signal Panel */}
          <div>
            <div style={{
              background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e35',
              borderRadius: 12, padding: 16,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} color="#f0c674" /> Signals
              </h3>
              {signals.length === 0 ? (
                <p style={{ color: '#555', fontSize: 12, margin: 0 }}>No signals detected</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {signals.map((s, i) => (
                    <div key={i} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: s.type.includes('buy') ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
                      border: `1px solid ${s.type.includes('buy') ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px', borderRadius: 3,
                          background: 'rgba(201,168,76,0.15)', color: '#c9a84c',
                        }}>{s.type.replace('_', ' ')}</span>
                        <span style={{ fontSize: 10, color: '#888' }}>{Math.round(s.confidence * 100)}%</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#ccc', lineHeight: 1.4 }}>{s.description}</div>
                      <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{s.date?.split('T')[0]}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
