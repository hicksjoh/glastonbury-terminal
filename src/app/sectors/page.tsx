'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';

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
      try {
        const res = await fetch(`/api/sectors?type=stocks&sector=${encodeURIComponent(selectedSector)}`);
        if (res.ok) setStocks(await res.json().then(d => d.stocks || []));
      } catch (err) {
        console.error('Sector stocks error:', err);
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
    ? stocks.filter(s => s.sector === selectedSector).sort((a, b) => b.marketCap - a.marketCap).slice(0, 20)
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
                return (
                  <div
                    key={s.sector}
                    onClick={() => setSelectedSector(selectedSector === s.sector ? null : s.sector)}
                    style={{
                      background: getBgColor(pct),
                      border: selectedSector === s.sector
                        ? '2px solid #f0c674'
                        : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      padding: '16px 14px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ color: '#d0d0e0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                      {s.sector}
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

            {/* Drill-down */}
            {selectedSector && filteredStocks.length > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <h3 style={{ color: '#f0c674', fontSize: 14, fontWeight: 600, margin: 0 }}>
                    Top {selectedSector} Stocks
                  </h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1, padding: 4 }}>
                  {filteredStocks.map(stock => {
                    const isUp = stock.changesPercentage >= 0;
                    return (
                      <div
                        key={stock.symbol}
                        onClick={() => window.location.href = `/stock/${stock.symbol}`}
                        style={{
                          background: getBgColor(stock.changesPercentage),
                          padding: '12px',
                          cursor: 'pointer',
                          borderRadius: 6,
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                          {stock.symbol}
                        </div>
                        <div style={{ color: '#888', fontSize: 10, marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {stock.name?.slice(0, 18)}
                        </div>
                        <div style={{
                          color: getColor(stock.changesPercentage),
                          fontWeight: 600,
                          fontSize: 14,
                          fontFamily: "'JetBrains Mono', monospace",
                          marginTop: 4,
                        }}>
                          {isUp ? '+' : ''}{stock.changesPercentage.toFixed(2)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
