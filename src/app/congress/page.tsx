'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';
import { Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';

interface CongressTrade {
  id: string;
  politician: string;
  party: string | null;
  state: string | null;
  ticker: string;
  transaction_type: string;
  amount_range: string | null;
  date_filed: string | null;
  date_traded: string | null;
  filing_url: string | null;
  source: string;
}

type SortKey = 'politician' | 'ticker' | 'transaction_type' | 'date_traded' | 'amount_range';

const PARTY_COLORS: Record<string, string> = {
  D: '#60a5fa',
  R: '#f87171',
  I: '#a78bfa',
};

export default function CongressPage() {
  const [trades, setTrades] = useState<CongressTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [partyFilter, setPartyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [tickerSearch, setTickerSearch] = useState('');
  const [debouncedTicker, setDebouncedTicker] = useState('');

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('date_traded');
  const [sortAsc, setSortAsc] = useState(false);

  // Debounce ticker search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTicker(tickerSearch), 300);
    return () => clearTimeout(t);
  }, [tickerSearch]);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (partyFilter) params.set('party', partyFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (debouncedTicker) params.set('ticker', debouncedTicker);
      const res = await fetch(`/api/congress?${params}`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [partyFilter, typeFilter, debouncedTicker]);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }, [sortKey, sortAsc]);

  const sorted = useMemo(() => {
    const arr = [...trades];
    arr.sort((a, b) => {
      const av = (a[sortKey] || '') as string;
      const bv = (b[sortKey] || '') as string;
      const cmp = av.localeCompare(bv);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [trades, sortKey, sortAsc]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
  };

  return (
    <AppShell>
      <ErrorBoundary label="congress-page">
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8e8', marginBottom: 6 }}>
            Congressional Trades
          </h1>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
            Track what Congress members are buying and selling. Politicians&apos; trades are public record.
          </p>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: '#1a1a24', border: '1px solid #2a2a3a' }}>
              <Search size={13} color="#666" />
              <input
                type="text"
                placeholder="Search ticker..."
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value)}
                aria-label="Search by ticker symbol"
                style={{
                  background: 'transparent', border: 'none', color: '#e8e8e8', fontSize: 12,
                  outline: 'none', width: 100,
                }}
              />
            </div>
            <select
              value={partyFilter}
              onChange={e => setPartyFilter(e.target.value)}
              aria-label="Filter by party"
              style={{
                padding: '6px 12px', borderRadius: 8, background: '#1a1a24', border: '1px solid #2a2a3a',
                color: '#e8e8e8', fontSize: 12, cursor: 'pointer',
              }}
            >
              <option value="">All Parties</option>
              <option value="D">Democrat</option>
              <option value="R">Republican</option>
              <option value="I">Independent</option>
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              aria-label="Filter by transaction type"
              style={{
                padding: '6px 12px', borderRadius: 8, background: '#1a1a24', border: '1px solid #2a2a3a',
                color: '#e8e8e8', fontSize: 12, cursor: 'pointer',
              }}
            >
              <option value="">Buy &amp; Sell</option>
              <option value="buy">Buy Only</option>
              <option value="sell">Sell Only</option>
            </select>
            <Filter size={13} color="#555" />
          </div>

          {/* Table */}
          {loading ? (
            <LoadingState variant="table" rows={8} cols={5} />
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#555', fontSize: 14 }}>
              No congressional trades found. Try adjusting filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #1e1e35' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#12122a' }}>
                    {([
                      ['politician', 'Politician'],
                      ['ticker', 'Ticker'],
                      ['transaction_type', 'Buy/Sell'],
                      ['amount_range', 'Amount'],
                      ['date_traded', 'Date Traded'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        style={{
                          padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
                          color: '#888', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: '0.05em', borderBottom: '1px solid #1e1e35',
                          userSelect: 'none', whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {label} <SortIcon k={key} />
                        </span>
                      </th>
                    ))}
                    <th style={{ padding: '10px 14px', borderBottom: '1px solid #1e1e35', color: '#888', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>
                      Party
                    </th>
                    <th style={{ padding: '10px 14px', borderBottom: '1px solid #1e1e35', color: '#888', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 100).map(t => (
                    <>
                      <tr
                        key={t.id}
                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                        style={{
                          cursor: 'pointer', background: expandedId === t.id ? 'rgba(138,92,246,0.04)' : 'transparent',
                          transition: 'background 100ms ease',
                        }}
                      >
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35', color: '#d0d0e0' }}>
                          {t.politician}
                          {t.state && <span style={{ color: '#555', marginLeft: 4 }}>({t.state})</span>}
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35', fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace" }}>
                          {t.ticker}
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: t.transaction_type === 'buy' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                            color: t.transaction_type === 'buy' ? '#4ade80' : '#f87171',
                          }}>
                            {t.transaction_type === 'buy' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35', color: '#aaa', fontSize: 11 }}>
                          {t.amount_range || '—'}
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35', color: '#888', fontSize: 11 }}>
                          {t.date_traded || '—'}
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35' }}>
                          {t.party && (
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                              background: `${PARTY_COLORS[t.party] || '#888'}18`,
                              color: PARTY_COLORS[t.party] || '#888',
                            }}>
                              {t.party}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid #1e1e35', color: '#555', fontSize: 10, textTransform: 'uppercase' }}>
                          {t.source}
                        </td>
                      </tr>
                      {expandedId === t.id && (
                        <tr key={`${t.id}-detail`}>
                          <td colSpan={7} style={{ padding: '12px 20px', background: 'rgba(138,92,246,0.03)', borderBottom: '1px solid #1e1e35' }}>
                            <div style={{ display: 'flex', gap: 24, fontSize: 12 }}>
                              <div>
                                <span style={{ color: '#666' }}>Filed: </span>
                                <span style={{ color: '#aaa' }}>{t.date_filed || 'N/A'}</span>
                              </div>
                              <div>
                                <span style={{ color: '#666' }}>Source: </span>
                                <span style={{ color: '#aaa' }}>{t.source === 'senate' ? 'Senate eFD' : 'House Clerk'}</span>
                              </div>
                              {t.filing_url && (
                                <a
                                  href={t.filing_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: '#8a5cf6', textDecoration: 'underline' }}
                                >
                                  View Filing
                                </a>
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
        </div>
      </ErrorBoundary>
    </AppShell>
  );
}
