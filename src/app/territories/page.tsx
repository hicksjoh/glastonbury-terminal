'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { MapPin, Building2, DollarSign, ArrowUpDown } from 'lucide-react';

interface Territory {
  id: string;
  territory_id: string;
  name: string;
  region: string;
  ar_agreement: string;
  status: string;
  strategy: string;
  fees_paid: number;
  royalties_earned: number;
  units_sold: number;
  home_value_index: number | null;
  permit_count: number;
  projected_breakeven: string | null;
}

interface Summary {
  total: number;
  by_agreement: { seacoast: number; westcoast: number };
  by_strategy: { operate: number; sell: number; hybrid: number };
  by_status: { active: number; developing: number; sold: number };
  total_fees_paid: number;
  total_royalties: number;
}

function formatCurrency(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  developing: { color: '#f0c674', bg: 'rgba(240,198,116,0.1)' },
  sold: { color: '#22d3ee', bg: 'rgba(34,211,238,0.1)' },
  listed: { color: '#8a5cf6', bg: 'rgba(138,92,246,0.1)' },
};

const STRATEGY_COLORS: Record<string, string> = {
  operate: '#4ade80',
  sell: '#f0c674',
  hybrid: '#8a5cf6',
};

export default function TerritoriesPage() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [selectedTerritory, setSelectedTerritory] = useState<Territory | null>(null);
  const [sortField, setSortField] = useState<string>('territory_id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    const params = filter !== 'all' ? `?filter=${filter}` : '';
    fetch(`/api/territories${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTerritories(d.data.territories);
          setSummary(d.data.summary);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  const sorted = [...territories].sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[sortField];
    const bVal = (b as unknown as Record<string, unknown>)[sortField];
    const cmp = String(aVal || '').localeCompare(String(bVal || ''), undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'seacoast', label: 'Seacoast FL (13)' },
    { key: 'westcoast', label: 'West Coast FL (10)' },
    { key: 'operate', label: 'Operate' },
    { key: 'sell', label: 'Sell' },
    { key: 'hybrid', label: 'Hybrid' },
  ];

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Territory Command</h1>
        <p style={{ color: '#8888a8', fontSize: 14, margin: '0 0 28px' }}>
          CR3 American Exteriors — 23 Franchise Territories
        </p>

        {/* Summary Cards */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 16 }}>
              <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Total Territories
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
                {summary.total}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                <span style={{ color: '#4ade80' }}>{summary.by_status.active} active</span>
                <span style={{ color: '#f0c674' }}>{summary.by_status.developing} dev</span>
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 16 }}>
              <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Strategy Mix
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                {(['operate', 'sell', 'hybrid'] as const).map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: STRATEGY_COLORS[s] }} />
                    <span style={{ color: '#e8e8f0', fontSize: 13, fontWeight: 600 }}>{summary.by_strategy[s]}</span>
                    <span style={{ color: '#555570', fontSize: 11, textTransform: 'capitalize' }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 16 }}>
              <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Total Fees Paid
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#f87171', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatCurrency(summary.total_fees_paid)}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35', borderRadius: 14, padding: 16 }}>
              <div style={{ color: '#8888a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Total Royalties
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatCurrency(summary.total_royalties)}
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setLoading(true); }}
              style={{
                background: filter === f.key ? 'rgba(138,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${filter === f.key ? '#8a5cf6' : '#1e1e35'}`,
                borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
                color: filter === f.key ? '#8a5cf6' : '#8888a8', fontSize: 12, fontWeight: 500,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Territory Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#555570' }}>Loading territories...</div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid #1e1e35', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e1e35' }}>
                  {[
                    { key: 'territory_id', label: 'Territory ID' },
                    { key: 'region', label: 'Region' },
                    { key: 'ar_agreement', label: 'Agreement' },
                    { key: 'status', label: 'Status' },
                    { key: 'strategy', label: 'Strategy' },
                    { key: 'units_sold', label: 'Units' },
                    { key: 'fees_paid', label: 'Fees Paid' },
                    { key: 'royalties_earned', label: 'Royalties' },
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        textAlign: 'left', padding: '12px 14px', fontSize: 11, color: '#555570',
                        textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {col.label}
                        {sortField === col.key && <ArrowUpDown size={10} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(t => {
                  const sc = STATUS_COLORS[t.status] || STATUS_COLORS['developing'];
                  return (
                    <tr
                      key={t.territory_id}
                      onClick={() => setSelectedTerritory(selectedTerritory?.territory_id === t.territory_id ? null : t)}
                      style={{
                        borderBottom: '1px solid rgba(30,30,53,0.5)', cursor: 'pointer',
                        background: selectedTerritory?.territory_id === t.territory_id ? 'rgba(138,92,246,0.06)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#e8e8f0', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={12} color={sc.color} />
                          {t.territory_id}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', color: '#8888a8', fontSize: 12 }}>{t.region}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          padding: '3px 8px', borderRadius: 4,
                          background: t.ar_agreement === 'seacoast' ? 'rgba(34,211,238,0.1)' : 'rgba(138,92,246,0.1)',
                          color: t.ar_agreement === 'seacoast' ? '#22d3ee' : '#8a5cf6',
                        }}>
                          {t.ar_agreement}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          padding: '3px 8px', borderRadius: 4,
                          background: sc.bg, color: sc.color,
                        }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          color: STRATEGY_COLORS[t.strategy] || '#8888a8',
                        }}>
                          {t.strategy}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#e8e8f0' }}>
                        {t.units_sold}
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#f87171' }}>
                        {formatCurrency(Number(t.fees_paid || 0))}
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#4ade80' }}>
                        {formatCurrency(Number(t.royalties_earned || 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail Panel */}
        {selectedTerritory && (
          <div style={{
            marginTop: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e35',
            borderRadius: 14, padding: 24, animation: 'fadeIn 0.3s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#f0c674', fontSize: 16, fontWeight: 700, margin: 0 }}>
                {selectedTerritory.name} — {selectedTerritory.territory_id}
              </h3>
              <button onClick={() => setSelectedTerritory(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#555570', fontSize: 12,
              }}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <div>
                <div style={{ color: '#555570', fontSize: 11, marginBottom: 4 }}>Region</div>
                <div style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600 }}>{selectedTerritory.region}</div>
              </div>
              <div>
                <div style={{ color: '#555570', fontSize: 11, marginBottom: 4 }}>AR Agreement</div>
                <div style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{selectedTerritory.ar_agreement}</div>
              </div>
              <div>
                <div style={{ color: '#555570', fontSize: 11, marginBottom: 4 }}>Strategy</div>
                <div style={{ color: STRATEGY_COLORS[selectedTerritory.strategy], fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{selectedTerritory.strategy}</div>
              </div>
              <div>
                <div style={{ color: '#555570', fontSize: 11, marginBottom: 4 }}>Break-Even</div>
                <div style={{ color: '#e8e8f0', fontSize: 14, fontWeight: 600 }}>{selectedTerritory.projected_breakeven || 'TBD'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
