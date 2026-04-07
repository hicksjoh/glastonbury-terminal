'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Plus, Trash2, Search, Bookmark } from 'lucide-react';

interface ScreenerFilter {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface ScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  price: number;
  beta: number;
  volume: number;
  sector: string;
  industry: string;
  exchange: string;
  dividendYield: number;
  pe: number | null;
}

const FILTER_FIELDS = [
  { value: 'marketCap', label: 'Market Cap', type: 'number' },
  { value: 'price', label: 'Price', type: 'number' },
  { value: 'pe', label: 'P/E Ratio', type: 'number' },
  { value: 'beta', label: 'Beta', type: 'number' },
  { value: 'volume', label: 'Volume', type: 'number' },
  { value: 'dividendYield', label: 'Dividend Yield', type: 'number' },
  { value: 'roe', label: 'ROE (%)', type: 'number' },
  { value: 'roa', label: 'ROA (%)', type: 'number' },
  { value: 'netMargin', label: 'Net Margin (%)', type: 'number' },
  { value: 'revenueGrowth', label: 'Revenue Growth (%)', type: 'number' },
  { value: 'sector', label: 'Sector', type: 'select' },
  { value: 'industry', label: 'Industry', type: 'text' },
];

const OPERATORS = ['>', '<', '>=', '<=', '='];

const SECTORS = [
  'Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical',
  'Communication Services', 'Industrials', 'Consumer Defensive', 'Energy',
  'Real Estate', 'Utilities', 'Basic Materials',
];

const PRESETS = [
  {
    name: 'Dividend Aristocrats',
    filters: [
      { id: '1', field: 'dividendYield', operator: '>', value: '3' },
      { id: '2', field: 'marketCap', operator: '>', value: '10000000000' },
    ],
  },
  {
    name: 'Growth Monsters',
    filters: [
      { id: '1', field: 'marketCap', operator: '>', value: '5000000000' },
      { id: '2', field: 'beta', operator: '>', value: '1.2' },
      { id: '3', field: 'volume', operator: '>', value: '1000000' },
    ],
  },
  {
    name: 'Value Plays',
    filters: [
      { id: '1', field: 'pe', operator: '<', value: '15' },
      { id: '2', field: 'marketCap', operator: '>', value: '1000000000' },
      { id: '3', field: 'volume', operator: '>', value: '500000' },
    ],
  },
];

let filterId = 10;

export default function ScreenerPage() {
  const [filters, setFilters] = useState<ScreenerFilter[]>([
    { id: '1', field: 'marketCap', operator: '>', value: '1000000000' },
  ]);
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('marketCap');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const addFilter = () => {
    filterId++;
    setFilters(prev => [...prev, { id: String(filterId), field: 'price', operator: '>', value: '' }]);
  };

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  };

  const updateFilter = (id: string, key: keyof ScreenerFilter, value: string) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, [key]: value } : f));
  };

  const loadPreset = (preset: typeof PRESETS[0]) => {
    setFilters(preset.filters.map((f, i) => ({ ...f, id: String(100 + i) })));
  };

  const runScreen = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: filters.filter(f => f.value).map(f => ({
            field: f.field,
            operator: f.operator,
            value: f.field === 'sector' || f.field === 'industry' ? f.value : Number(f.value),
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
        if (data.error) setErrorMsg(data.error);
      }
    } catch (err) {
      console.error('Screen error:', err);
      setErrorMsg('Failed to run screen — check your connection');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sorted = [...results].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortBy] as number ?? 0;
    const bv = (b as unknown as Record<string, unknown>)[sortBy] as number ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const fmtCap = (n: number) => {
    if (!n) return '-';
    if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n.toLocaleString()}`;
  };

  return (
    <AppShell>
      <ErrorBoundary label="Screener">
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Stock Screener</h1>
        <p style={{ color: '#888', fontSize: 14, margin: '0 0 24px' }}>Build custom screens with compound filters</p>

        {/* Presets */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button
              key={p.name}
              onClick={() => loadPreset(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 20,
                border: '1px solid rgba(240, 198, 116, 0.3)',
                background: 'rgba(240, 198, 116, 0.08)',
                color: '#f0c674', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Bookmark size={12} /> {p.name}
            </button>
          ))}
        </div>

        {/* Filter Builder */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12, padding: 20, marginBottom: 24,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Filters (AND logic)
          </div>
          {filters.map(f => {
            const fieldDef = FILTER_FIELDS.find(ff => ff.value === f.field);
            return (
              <div key={f.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={f.field}
                  onChange={e => updateFilter(f.id, 'field', e.target.value)}
                  style={selectStyle}
                >
                  {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
                </select>
                {fieldDef?.type === 'select' ? (
                  <select value={f.value} onChange={e => updateFilter(f.id, 'value', e.target.value)} style={selectStyle}>
                    <option value="">Select...</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <>
                    <select value={f.operator} onChange={e => updateFilter(f.id, 'operator', e.target.value)} style={{ ...selectStyle, width: 60 }}>
                      {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input
                      type="text"
                      value={f.value}
                      onChange={e => updateFilter(f.id, 'value', e.target.value)}
                      placeholder="Value"
                      style={inputStyle}
                    />
                  </>
                )}
                <button onClick={() => removeFilter(f.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button onClick={addFilter} style={addBtnStyle}><Plus size={14} /> Add Filter</button>
            <button onClick={runScreen} disabled={loading} style={runBtnStyle}>
              <Search size={14} /> {loading ? 'Scanning...' : 'Run Screen'}
            </button>
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)',
            borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#f59e0b',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#888', fontSize: 12 }}>
              {results.length} results found
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {[
                    { key: 'symbol', label: 'Symbol', align: 'left' },
                    { key: 'price', label: 'Price', align: 'right' },
                    { key: 'marketCap', label: 'Mkt Cap', align: 'right' },
                    { key: 'beta', label: 'Beta', align: 'right' },
                    { key: 'volume', label: 'Volume', align: 'right' },
                    { key: 'sector', label: 'Sector', align: 'left' },
                  ].map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      textAlign: col.align as 'left' | 'right',
                      padding: '10px 12px', color: sortBy === col.key ? '#f0c674' : '#666',
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none',
                    }}>
                      {col.label} {sortBy === col.key ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr
                    key={r.symbol}
                    onClick={() => window.location.href = `/stock/${r.symbol}`}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(138, 92, 246, 0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{r.symbol}</div>
                      <div style={{ color: '#555', fontSize: 10, marginTop: 1 }}>{r.companyName?.slice(0, 30)}</div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ccc', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                      ${r.price?.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#888', fontSize: 12 }}>
                      {fmtCap(r.marketCap)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#888', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                      {r.beta?.toFixed(2) || '-'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#888', fontSize: 12 }}>
                      {r.volume ? (r.volume / 1e6).toFixed(1) + 'M' : '-'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#666', fontSize: 11 }}>
                      {r.sector}
                    </td>
                  </tr>
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

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#ccc',
  fontSize: 12,
  outline: 'none',
  minWidth: 140,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#fff',
  fontSize: 12,
  outline: 'none',
  width: 120,
  fontFamily: "'JetBrains Mono', monospace",
};

const addBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: '#888', fontSize: 12, cursor: 'pointer',
};

const runBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 20px', borderRadius: 8,
  border: '1px solid rgba(240, 198, 116, 0.3)',
  background: 'rgba(240, 198, 116, 0.15)',
  color: '#f0c674', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
