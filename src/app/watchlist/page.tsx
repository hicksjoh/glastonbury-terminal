'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SparklineChart } from '@/components/SparklineChart';
import { cacheSet, cacheGet, formatStaleAge } from '@/lib/cache';

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  pe: number;
  marketCap: number;
}

const DEFAULT_WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA',
  'JPM', 'V', 'UNH', 'XOM', 'COIN', 'NFLX', 'BA', 'DIS',
];

const SPARKLINE_REFRESH_INTERVAL = 300000; // 5 minutes

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>('symbol');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [addSymbol, setAddSymbol] = useState('');
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const lastSparklineRefresh = useRef<number>(0);
  const [isStale, setIsStale] = useState(false);
  const [staleAge, setStaleAge] = useState(0);

  const fetchSparklines = useCallback(async (symbols: string[]) => {
    const now = Date.now();
    if (now - lastSparklineRefresh.current < SPARKLINE_REFRESH_INTERVAL && Object.keys(sparklines).length > 0) return;

    try {
      const res = await fetch(`/api/watchlist/sparklines?symbols=${symbols.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        setSparklines(data.sparklines || {});
        lastSparklineRefresh.current = now;
        cacheSet('watchlist_sparklines', data.sparklines || {}, SPARKLINE_REFRESH_INTERVAL);
      }
    } catch {
      // Try cache
      const cached = cacheGet<Record<string, number[]>>('watchlist_sparklines');
      if (cached) setSparklines(cached.data);
    }
  }, [sparklines]);

  const fetchQuotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/watchlist?symbols=${watchlistSymbols.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.quotes || []);
        setIsStale(false);
        cacheSet('watchlist_quotes', data.quotes || []);
      } else {
        throw new Error('Fetch failed');
      }
    } catch {
      // Fall back to cache
      const cached = cacheGet<WatchlistItem[]>('watchlist_quotes');
      if (cached) {
        setItems(cached.data);
        setIsStale(true);
        setStaleAge(cached.ageMs);
      }
    } finally {
      setLoading(false);
    }
  }, [watchlistSymbols]);

  useEffect(() => {
    fetchQuotes();
    fetchSparklines(watchlistSymbols);
    const interval = setInterval(fetchQuotes, 30000);
    return () => clearInterval(interval);
  }, [fetchQuotes, fetchSparklines, watchlistSymbols]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir(col === 'symbol' ? 'asc' : 'desc');
    }
  };

  const handleAddSymbol = () => {
    const sym = addSymbol.trim().toUpperCase();
    if (sym && !watchlistSymbols.includes(sym)) {
      setWatchlistSymbols(prev => [...prev, sym]);
      setAddSymbol('');
    }
  };

  const handleRemoveSymbol = (sym: string) => {
    setWatchlistSymbols(prev => prev.filter(s => s !== sym));
    setItems(prev => prev.filter(i => i.symbol !== sym));
  };

  const sorted = [...items].sort((a, b) => {
    const key = sortBy as keyof WatchlistItem;
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const formatMktCap = (cap: number) => {
    if (!cap) return '-';
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
    return `$${cap.toLocaleString()}`;
  };

  const SortHeader = ({ col, label, align }: { col: string; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        textAlign: (align || 'right') as 'left' | 'right',
        padding: '10px 12px',
        color: sortBy === col ? '#f0c674' : '#888',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label} {sortBy === col ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
    </th>
  );

  return (
    <AppShell>
      <div>
        {isStale && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 8,
            padding: '8px 16px',
            marginBottom: 16,
            color: '#f59e0b',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>&#9888;</span>
            Showing cached data from {formatStaleAge(staleAge)} ago — live feed reconnecting...
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>Watchlist</h1>
            <p style={{ color: '#888', fontSize: 14, margin: '4px 0 0' }}>
              {items.length} symbols &bull; Updates every 30s
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Add ticker..."
              value={addSymbol}
              onChange={e => setAddSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAddSymbol()}
              style={{
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(138, 92, 246, 0.2)',
                borderRadius: 8,
                color: '#fff',
                fontSize: 13,
                width: 120,
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddSymbol}
              style={{
                background: 'rgba(240, 198, 116, 0.15)',
                border: '1px solid rgba(240, 198, 116, 0.3)',
                borderRadius: 8,
                color: '#f0c674',
                padding: '8px 14px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Add
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>Loading watchlist...</div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <SortHeader col="symbol" label="Symbol" align="left" />
                  <th style={{ padding: '10px 8px', color: '#888', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>7D</th>
                  <SortHeader col="price" label="Price" />
                  <SortHeader col="changePercent" label="Change" />
                  <SortHeader col="volume" label="Volume" />
                  <SortHeader col="dayHigh" label="Day Range" />
                  <SortHeader col="marketCap" label="Mkt Cap" />
                  <SortHeader col="pe" label="P/E" />
                  <th style={{ width: 40, padding: '10px 12px' }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(item => (
                  <tr
                    key={item.symbol}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => window.location.href = `/stock/${item.symbol}`}
                  >
                    <td style={{ padding: '12px', textAlign: 'left' }}>
                      <div style={{ fontWeight: 700, color: '#fff', fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                        {item.symbol}
                      </div>
                      <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{item.name?.slice(0, 25)}</div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <SparklineChart data={sparklines[item.symbol] || []} width={100} height={36} />
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#fff', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                      ${item.price?.toFixed(2)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <span style={{
                        color: item.changePercent >= 0 ? '#4ade80' : '#f87171',
                        fontWeight: 600,
                        fontSize: 13,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {item.changePercent >= 0 ? '+' : ''}{item.changePercent?.toFixed(2)}%
                      </span>
                      <div style={{
                        color: item.change >= 0 ? 'rgba(74, 222, 128, 0.6)' : 'rgba(248, 113, 113, 0.6)',
                        fontSize: 11,
                        marginTop: 2,
                      }}>
                        {item.change >= 0 ? '+' : ''}${item.change?.toFixed(2)}
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.volume ? (item.volume / 1e6).toFixed(1) + 'M' : '-'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <span style={{ color: '#666', fontSize: 11 }}>${item.dayLow?.toFixed(0)}</span>
                        <div style={{
                          width: 50,
                          height: 4,
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: 2,
                          position: 'relative' as const,
                          overflow: 'hidden',
                        }}>
                          {item.dayHigh > item.dayLow && (
                            <div style={{
                              position: 'absolute' as const,
                              left: `${((item.price - item.dayLow) / (item.dayHigh - item.dayLow)) * 100}%`,
                              top: 0,
                              width: 3,
                              height: '100%',
                              background: '#f0c674',
                              borderRadius: 2,
                            }} />
                          )}
                        </div>
                        <span style={{ color: '#666', fontSize: 11 }}>${item.dayHigh?.toFixed(0)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12 }}>
                      {formatMktCap(item.marketCap)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.pe ? item.pe.toFixed(1) : '-'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleRemoveSymbol(item.symbol); }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#555',
                          cursor: 'pointer',
                          fontSize: 14,
                          padding: 4,
                        }}
                        title="Remove from watchlist"
                      >
                        x
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
