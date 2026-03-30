'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

interface ScreenerResult {
  symbol: string;
  underlying: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  iv: number;
  dte: number;
  volume: number;
  openInterest: number;
  delta: number;
  premiumYield: number;
  stockPrice: number;
}

const PRESETS = [
  { label: 'Covered Call Candidates', type: 'covered_call', color: '#4ade80' },
  { label: 'CSP Opportunities', type: 'csp', color: '#8a5cf6' },
  { label: 'Iron Condor Setups', type: 'iron_condor', color: '#c9a84c' },
  { label: 'High IV Rank', type: 'high_iv', color: '#f59e0b' },
  { label: 'Unusual Activity', type: 'unusual_activity', color: '#ef4444' },
];

export default function ScreenerPage() {
  const router = useRouter();
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [activeScan, setActiveScan] = useState('');

  // Filter state
  const [minIV, setMinIV] = useState('');
  const [maxIV, setMaxIV] = useState('');
  const [minDTE, setMinDTE] = useState('');
  const [maxDTE, setMaxDTE] = useState('');
  const [minVol, setMinVol] = useState('');

  async function runScan(scanType: string) {
    setLoading(true);
    setActiveScan(scanType);
    try {
      const res = await fetch('/api/options/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanType,
          minIV: minIV ? parseFloat(minIV) : undefined,
          maxIV: maxIV ? parseFloat(maxIV) : undefined,
          minDTE: minDTE ? parseInt(minDTE) : undefined,
          maxDTE: maxDTE ? parseInt(maxDTE) : undefined,
          minVolume: minVol ? parseInt(minVol) : undefined,
        }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setScanned(data.scanned || 0);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }

  function navigateToChain(underlying: string, expiration: string) {
    router.push(`/trading?tab=options&symbol=${underlying}&exp=${expiration}`);
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    backgroundColor: '#08080d',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    color: '#e8e8e8',
    fontSize: 12,
    outline: 'none',
    fontFamily: "'JetBrains Mono', monospace",
    width: 60,
  };

  return (
    <AppShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e8e8e8', margin: 0 }}>Options Screener</h1>
        <p style={{ color: '#6b6b80', fontSize: 13, marginTop: 4 }}>
          Scan for options opportunities across your watchlist
        </p>
      </div>

      {/* Preset Scan Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {PRESETS.map(p => (
          <button
            key={p.type}
            onClick={() => runScan(p.type)}
            disabled={loading}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: activeScan === p.type ? `1px solid ${p.color}` : '1px solid #2a2a3a',
              background: activeScan === p.type ? `${p.color}15` : '#1a1a2e',
              color: activeScan === p.type ? p.color : '#888',
              fontSize: 12,
              fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading && activeScan !== p.type ? 0.5 : 1,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom Filters */}
      <div className="terminal-card" style={{ padding: 14, marginBottom: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#6b6b80' }}>IV:</span>
          <input placeholder="min" value={minIV} onChange={e => setMinIV(e.target.value)} style={inputStyle} />
          <span style={{ color: '#555' }}>-</span>
          <input placeholder="max" value={maxIV} onChange={e => setMaxIV(e.target.value)} style={inputStyle} />
          <span style={{ fontSize: 10, color: '#555' }}>%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#6b6b80' }}>DTE:</span>
          <input placeholder="min" value={minDTE} onChange={e => setMinDTE(e.target.value)} style={inputStyle} />
          <span style={{ color: '#555' }}>-</span>
          <input placeholder="max" value={maxDTE} onChange={e => setMaxDTE(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#6b6b80' }}>Min Vol:</span>
          <input placeholder="0" value={minVol} onChange={e => setMinVol(e.target.value)} style={inputStyle} />
        </div>
        <button
          onClick={() => runScan('custom')}
          disabled={loading}
          style={{
            padding: '6px 16px', borderRadius: 6,
            background: '#8a5cf6', border: 'none',
            color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        {scanned > 0 && (
          <span style={{ fontSize: 11, color: '#6b6b80' }}>
            Scanned {scanned} symbols &bull; {results.length} results
          </span>
        )}
      </div>

      {/* Results Table */}
      {loading ? (
        <div className="terminal-card" style={{ textAlign: 'center', padding: 60, color: '#6b6b80' }}>
          Scanning options across {activeScan === 'custom' ? 'your filters' : activeScan.replace('_', ' ')}...
        </div>
      ) : results.length > 0 ? (
        <div className="terminal-card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                  {['Symbol', 'Strike', 'Exp', 'Type', 'Bid', 'Ask', 'IV', 'DTE', 'Volume', 'OI', 'Delta', 'Yield'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 10px',
                      fontSize: 10, color: '#6b6b80', textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={`${r.symbol}-${i}`}
                    style={{ borderBottom: '1px solid #1a1a24', cursor: 'pointer' }}
                    onClick={() => navigateToChain(r.underlying, r.expiration)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px', fontSize: 13, fontWeight: 700, color: '#c9a84c' }}>{r.underlying}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>${r.strike}</td>
                    <td style={{ padding: '10px', fontSize: 11, color: '#888' }}>{formatExpLabel(r.expiration)}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                        background: r.type === 'call' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
                        color: r.type === 'call' ? '#4ade80' : '#ef4444',
                        textTransform: 'uppercase',
                      }}>{r.type}</span>
                    </td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>${r.bid.toFixed(2)}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>${r.ask.toFixed(2)}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: r.iv > 40 ? '#f59e0b' : '#c8c8d0' }}>{r.iv.toFixed(0)}%</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: r.dte <= 7 ? '#f59e0b' : '#c8c8d0' }}>{r.dte}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.volume.toLocaleString()}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.openInterest.toLocaleString()}</td>
                    <td style={{ padding: '10px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.delta.toFixed(2)}</td>
                    <td style={{
                      padding: '10px', fontSize: 12, fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: r.premiumYield > 20 ? '#4ade80' : '#c8c8d0',
                    }}>{r.premiumYield.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : scanned > 0 ? (
        <div className="terminal-card" style={{ textAlign: 'center', padding: 40, color: '#6b6b80' }}>
          No results matching your criteria. Try broadening your filters.
        </div>
      ) : (
        <div className="terminal-card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>🔍</div>
          <div style={{ color: '#6b6b80', fontSize: 14 }}>Select a scan preset or set custom filters to search</div>
        </div>
      )}
    </AppShell>
  );
}

function formatExpLabel(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
