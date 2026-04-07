'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import SparklineChart from '@/components/SparklineChart';
import { SkeletonTable } from '@/components/Skeleton';
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

interface TargetData {
  notes: string | null;
  buyTarget: number | null;
  sellTarget: number | null;
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
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, TargetData>>({});
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});

  useEffect(() => { document.title = 'Watchlist | Glastonbury Terminal'; }, []);
  const [editBuyTarget, setEditBuyTarget] = useState<Record<string, string>>({});
  const [editSellTarget, setEditSellTarget] = useState<Record<string, string>>({});
  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

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
        if (data.targets) setTargets(data.targets);
        setIsStale(false);
        cacheSet('watchlist_quotes', data.quotes || []);
      } else {
        throw new Error('Fetch failed');
      }
    } catch {
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

  const saveTargetData = useCallback(async (symbol: string, field: 'notes' | 'buyTarget' | 'sellTarget', value: string) => {
    const payload: Record<string, unknown> = { symbol };
    if (field === 'notes') {
      payload.notes = value;
    } else if (field === 'buyTarget') {
      payload.buyTarget = value ? parseFloat(value) : null;
    } else if (field === 'sellTarget') {
      payload.sellTarget = value ? parseFloat(value) : null;
    }

    try {
      const res = await fetch('/api/watchlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setTargets(prev => ({
          ...prev,
          [symbol]: {
            notes: data.notes ?? prev[symbol]?.notes ?? null,
            buyTarget: data.buyTarget ?? prev[symbol]?.buyTarget ?? null,
            sellTarget: data.sellTarget ?? prev[symbol]?.sellTarget ?? null,
          },
        }));
      }
    } catch {
      // Silent fail — data stays local until next save
    }
  }, []);

  const handleFieldChange = useCallback((symbol: string, field: 'notes' | 'buyTarget' | 'sellTarget', value: string) => {
    if (field === 'notes') {
      setEditNotes(prev => ({ ...prev, [symbol]: value }));
    } else if (field === 'buyTarget') {
      setEditBuyTarget(prev => ({ ...prev, [symbol]: value }));
    } else {
      setEditSellTarget(prev => ({ ...prev, [symbol]: value }));
    }

    // Debounced auto-save
    const key = `${symbol}_${field}`;
    if (saveTimeoutRef.current[key]) clearTimeout(saveTimeoutRef.current[key]);
    saveTimeoutRef.current[key] = setTimeout(() => {
      saveTargetData(symbol, field, value);
    }, 1500);
  }, [saveTargetData]);

  const handleFieldBlur = useCallback((symbol: string, field: 'notes' | 'buyTarget' | 'sellTarget', value: string) => {
    const key = `${symbol}_${field}`;
    if (saveTimeoutRef.current[key]) clearTimeout(saveTimeoutRef.current[key]);
    saveTargetData(symbol, field, value);
  }, [saveTargetData]);

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
    if (expandedSymbol === sym) setExpandedSymbol(null);
  };

  const toggleExpand = (sym: string) => {
    if (expandedSymbol === sym) {
      setExpandedSymbol(null);
    } else {
      setExpandedSymbol(sym);
      // Initialize edit fields from targets
      const t = targets[sym];
      if (t) {
        setEditNotes(prev => ({ ...prev, [sym]: t.notes || '' }));
        setEditBuyTarget(prev => ({ ...prev, [sym]: t.buyTarget ? String(t.buyTarget) : '' }));
        setEditSellTarget(prev => ({ ...prev, [sym]: t.sellTarget ? String(t.sellTarget) : '' }));
      } else {
        setEditNotes(prev => ({ ...prev, [sym]: '' }));
        setEditBuyTarget(prev => ({ ...prev, [sym]: '' }));
        setEditSellTarget(prev => ({ ...prev, [sym]: '' }));
      }
    }
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

  const getTargetIndicators = (item: WatchlistItem) => {
    const t = targets[item.symbol];
    if (!t) return null;
    const indicators: JSX.Element[] = [];
    const price = item.price;

    if (t.buyTarget && price > 0) {
      const pctFromBuy = ((price - t.buyTarget) / price) * 100;
      const nearBuy = pctFromBuy <= 5 && pctFromBuy >= 0; // within 5% above buy target
      const crossedBuy = price <= t.buyTarget;
      if (crossedBuy) {
        indicators.push(
          <span key="buy" style={{
            color: '#4ade80',
            fontSize: 11,
            fontWeight: 700,
            animation: 'pulse-green 1.5s ease-in-out infinite',
            marginLeft: 6,
          }} title={`BUY target hit: $${t.buyTarget.toFixed(2)}`}>
            &#9660; BUY
          </span>
        );
      } else if (nearBuy) {
        indicators.push(
          <span key="buy" style={{
            color: 'rgba(74, 222, 128, 0.7)',
            fontSize: 10,
            marginLeft: 6,
          }} title={`Buy target: $${t.buyTarget.toFixed(2)} (${pctFromBuy.toFixed(1)}% away)`}>
            &#9660;
          </span>
        );
      }
    }

    if (t.sellTarget && price > 0) {
      const pctFromSell = ((t.sellTarget - price) / price) * 100;
      const nearSell = pctFromSell <= 5 && pctFromSell >= 0;
      const crossedSell = price >= t.sellTarget;
      if (crossedSell) {
        indicators.push(
          <span key="sell" style={{
            color: '#f87171',
            fontSize: 11,
            fontWeight: 700,
            animation: 'pulse-red 1.5s ease-in-out infinite',
            marginLeft: 6,
          }} title={`SELL target hit: $${t.sellTarget.toFixed(2)}`}>
            &#9650; SELL
          </span>
        );
      } else if (nearSell) {
        indicators.push(
          <span key="sell" style={{
            color: 'rgba(248, 113, 113, 0.7)',
            fontSize: 10,
            marginLeft: 6,
          }} title={`Sell target: $${t.sellTarget.toFixed(2)} (${pctFromSell.toFixed(1)}% away)`}>
            &#9650;
          </span>
        );
      }
    }

    return indicators.length > 0 ? <>{indicators}</> : null;
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
      <ErrorBoundary label="watchlist">
      <style>{`
        @keyframes pulse-green {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes pulse-red {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
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
          <div style={{ padding: '20px 0' }}>
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : items.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#6b6b80',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>&#9734;</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#888', marginBottom: 6 }}>Your watchlist is empty</div>
            <div style={{ fontSize: 13 }}>Add symbols above to start tracking.</div>
          </div>
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
                {sorted.map(item => {
                  const isExpanded = expandedSymbol === item.symbol;
                  const t = targets[item.symbol];
                  const hasTargets = t && (t.buyTarget || t.sellTarget || t.notes);
                  return (
                    <>
                      <tr
                        key={item.symbol}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid rgba(255,255,255,0.04)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          background: isExpanded ? 'rgba(138, 92, 246, 0.08)' : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td
                          style={{ padding: '12px', textAlign: 'left' }}
                          onClick={() => toggleExpand(item.symbol)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{
                              color: '#666',
                              fontSize: 10,
                              marginRight: 8,
                              transition: 'transform 0.2s',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              display: 'inline-block',
                            }}>&#9654;</span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, color: '#fff', fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
                                  {item.symbol}
                                </span>
                                {getTargetIndicators(item)}
                                {hasTargets && !getTargetIndicators(item) && (
                                  <span style={{ color: '#666', fontSize: 9, marginLeft: 6 }} title="Has notes/targets">&#9679;</span>
                                )}
                              </div>
                              <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{item.name?.slice(0, 25)}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }} onClick={() => toggleExpand(item.symbol)}>
                          <SparklineChart data={sparklines[item.symbol] || []} width={100} height={36} />
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#fff', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }} onClick={() => toggleExpand(item.symbol)}>
                          ${item.price?.toFixed(2)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }} onClick={() => toggleExpand(item.symbol)}>
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
                        <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }} onClick={() => toggleExpand(item.symbol)}>
                          {item.volume ? (item.volume / 1e6).toFixed(1) + 'M' : '-'}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }} onClick={() => toggleExpand(item.symbol)}>
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
                        <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12 }} onClick={() => toggleExpand(item.symbol)}>
                          {formatMktCap(item.marketCap)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }} onClick={() => toggleExpand(item.symbol)}>
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
                      {isExpanded && (
                        <tr key={`${item.symbol}-expanded`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td colSpan={9} style={{ padding: 0 }}>
                            <div style={{
                              background: 'rgba(138, 92, 246, 0.04)',
                              borderTop: '1px solid rgba(138, 92, 246, 0.15)',
                              padding: '16px 20px',
                              display: 'flex',
                              gap: 24,
                              alignItems: 'flex-start',
                            }}>
                              {/* Notes */}
                              <div style={{ flex: 2 }}>
                                <label style={{ color: '#888', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
                                  Notes
                                </label>
                                <textarea
                                  value={editNotes[item.symbol] ?? ''}
                                  onChange={e => handleFieldChange(item.symbol, 'notes', e.target.value)}
                                  onBlur={e => handleFieldBlur(item.symbol, 'notes', e.target.value)}
                                  placeholder="Add notes about this position..."
                                  rows={3}
                                  style={{
                                    width: '100%',
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 8,
                                    color: '#ccc',
                                    fontSize: 12,
                                    fontFamily: "'JetBrains Mono', monospace",
                                    padding: '8px 10px',
                                    resize: 'vertical',
                                    outline: 'none',
                                    lineHeight: 1.5,
                                  }}
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>

                              {/* Buy Target */}
                              <div style={{ flex: 1 }}>
                                <label style={{ color: '#4ade80', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
                                  Buy Target
                                </label>
                                <div style={{ position: 'relative' }}>
                                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#4ade80', fontSize: 13, fontWeight: 600 }}>$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editBuyTarget[item.symbol] ?? ''}
                                    onChange={e => handleFieldChange(item.symbol, 'buyTarget', e.target.value)}
                                    onBlur={e => handleFieldBlur(item.symbol, 'buyTarget', e.target.value)}
                                    placeholder="0.00"
                                    style={{
                                      width: '100%',
                                      background: 'rgba(74, 222, 128, 0.06)',
                                      border: '1px solid rgba(74, 222, 128, 0.2)',
                                      borderRadius: 8,
                                      color: '#4ade80',
                                      fontSize: 14,
                                      fontWeight: 600,
                                      fontFamily: "'JetBrains Mono', monospace",
                                      padding: '8px 10px 8px 22px',
                                      outline: 'none',
                                    }}
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                                {(() => {
                                  const bt = parseFloat(editBuyTarget[item.symbol]);
                                  if (!bt || !item.price) return null;
                                  const pct = ((item.price - bt) / item.price) * 100;
                                  const crossed = item.price <= bt;
                                  return (
                                    <div style={{
                                      marginTop: 6,
                                      fontSize: 11,
                                      color: crossed ? '#4ade80' : '#888',
                                      fontFamily: "'JetBrains Mono', monospace",
                                      fontWeight: crossed ? 700 : 400,
                                    }}>
                                      {crossed ? (
                                        <span style={{ animation: 'pulse-green 1.5s ease-in-out infinite' }}>
                                          &#9733; PRICE AT/BELOW TARGET
                                        </span>
                                      ) : (
                                        <>&#9660; {pct.toFixed(1)}% below current</>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Sell Target */}
                              <div style={{ flex: 1 }}>
                                <label style={{ color: '#f87171', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
                                  Sell Target
                                </label>
                                <div style={{ position: 'relative' }}>
                                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#f87171', fontSize: 13, fontWeight: 600 }}>$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editSellTarget[item.symbol] ?? ''}
                                    onChange={e => handleFieldChange(item.symbol, 'sellTarget', e.target.value)}
                                    onBlur={e => handleFieldBlur(item.symbol, 'sellTarget', e.target.value)}
                                    placeholder="0.00"
                                    style={{
                                      width: '100%',
                                      background: 'rgba(248, 113, 113, 0.06)',
                                      border: '1px solid rgba(248, 113, 113, 0.2)',
                                      borderRadius: 8,
                                      color: '#f87171',
                                      fontSize: 14,
                                      fontWeight: 600,
                                      fontFamily: "'JetBrains Mono', monospace",
                                      padding: '8px 10px 8px 22px',
                                      outline: 'none',
                                    }}
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                                {(() => {
                                  const st = parseFloat(editSellTarget[item.symbol]);
                                  if (!st || !item.price) return null;
                                  const pct = ((st - item.price) / item.price) * 100;
                                  const crossed = item.price >= st;
                                  return (
                                    <div style={{
                                      marginTop: 6,
                                      fontSize: 11,
                                      color: crossed ? '#f87171' : '#888',
                                      fontFamily: "'JetBrains Mono', monospace",
                                      fontWeight: crossed ? 700 : 400,
                                    }}>
                                      {crossed ? (
                                        <span style={{ animation: 'pulse-red 1.5s ease-in-out infinite' }}>
                                          &#9733; PRICE AT/ABOVE TARGET
                                        </span>
                                      ) : (
                                        <>&#9650; {pct.toFixed(1)}% above current</>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Quick link to stock detail */}
                              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                                <button
                                  onClick={e => { e.stopPropagation(); window.location.href = `/stock/${item.symbol}`; }}
                                  style={{
                                    background: 'rgba(240, 198, 116, 0.1)',
                                    border: '1px solid rgba(240, 198, 116, 0.2)',
                                    borderRadius: 8,
                                    color: '#f0c674',
                                    padding: '8px 14px',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  Full Analysis &#8594;
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </ErrorBoundary>
    </AppShell>
  );
}
