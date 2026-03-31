'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SparklineChart } from '@/components/SparklineChart';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface SectorData {
  sector: string;
  changesPercentage: string;
}

interface SectorStock {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  marketCap: number;
  sector: string;
}

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [stocks, setStocks] = useState<SectorStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [loadingStocks, setLoadingStocks] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const sectorRes = await fetch('/api/sectors');
        if (sectorRes.ok) setSectors(await sectorRes.json().then(d => d.sectors || []));
      } catch (err) {
        console.error('Sectors fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!selectedSector) { setStocks([]); return; }
    const fetchStocks = async () => {
      setLoadingStocks(true);
      try {
        const res = await fetch(`/api/sectors?type=stocks&sector=${encodeURIComponent(selectedSector)}`);
        if (res.ok) setStocks(await res.json().then(d => d.stocks || []));
      } catch (err) {
        console.error('Sector stocks error:', err);
      } finally {
        setLoadingStocks(false);
      }
    };
    fetchStocks();
  }, [selectedSector]);

  const getColor = (pct: number) => {
    if (pct >= 2) return '#22c55e';
    if (pct >= 1) return '#4ade80';
    if (pct >= 0.25) return '#86efac';
    if (pct > -0.25) return '#888';
    if (pct > -1) return '#fca5a5';
    if (pct > -2) return '#f87171';
    return '#ef4444';
  };

  const getBgColor = (pct: number) => {
    if (pct >= 2) return 'rgba(34, 197, 94, 0.25)';
    if (pct >= 1) return 'rgba(74, 222, 128, 0.2)';
    if (pct >= 0.25) return 'rgba(74, 222, 128, 0.1)';
    if (pct > -0.25) return 'rgba(255,255,255,0.03)';
    if (pct > -1) return 'rgba(248, 113, 113, 0.1)';
    if (pct > -2) return 'rgba(248, 113, 113, 0.2)';
    return 'rgba(239, 68, 68, 0.25)';
  };

  const filteredStocks = selectedSector
    ? stocks.filter(s => s.sector === selectedSector).sort((a, b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage)).slice(0, 5)
    : [];

  return (
    <AppShell>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Sector Performance</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Market heatmap by sector &bull; Click to drill down</p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading sectors...</div>
        ) : (
          <>
            {/* Sector Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 8,
              marginBottom: 32,
            }}>
              {sectors.map(s => {
                const pct = parseFloat(s.changesPercentage);
                const isSelected = selectedSector === s.sector;
                return (
                  <div
                    key={s.sector}
                    onClick={() => setSelectedSector(isSelected ? null : s.sector)}
                    style={{
                      background: getBgColor(pct),
                      border: isSelected
                        ? '2px solid #f0c674'
                        : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      padding: '16px 14px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ color: '#d0d0e0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                        {s.sector}
                      </div>
                      {isSelected ? <ChevronUp size={14} color="#f0c674" /> : <ChevronDown size={14} color="#555" />}
                    </div>
                    <div style={{
                      color: getColor(pct),
                      fontSize: 22,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Drill-down Panel */}
            {selectedSector && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                animation: 'fadeIn 0.3s ease',
              }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ color: '#f0c674', fontSize: 14, fontWeight: 600, margin: 0 }}>
                    Top 5 Movers — {selectedSector}
                  </h3>
                  <button
                    onClick={() => setSelectedSector(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#666' }}
                  >
                    <X size={16} />
                  </button>
                </div>
                {loadingStocks ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading top movers...</div>
                ) : filteredStocks.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ticker</th>
                        <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company</th>
                        <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>% Change</th>
                        <th style={{ textAlign: 'right', padding: '10px 16px', fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStocks.map(stock => (
                        <tr
                          key={stock.symbol}
                          onClick={() => window.location.href = `/stock/${stock.symbol}`}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>{stock.symbol}</span>
                          </td>
                          <td style={{ padding: '12px', color: '#888', fontSize: 12 }}>{stock.name?.slice(0, 30)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <span style={{
                              color: getColor(stock.changesPercentage),
                              fontWeight: 600,
                              fontSize: 14,
                              fontFamily: "'JetBrains Mono', monospace",
                            }}>
                              {stock.changesPercentage >= 0 ? '+' : ''}{stock.changesPercentage.toFixed(2)}%
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: '#ccc', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                            ${stock.price?.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 13 }}>
                    Connect FMP API for drill-down data
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
