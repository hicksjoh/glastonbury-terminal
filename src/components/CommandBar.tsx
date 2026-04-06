'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  type: 'stock' | 'page';
  label: string;
  sublabel?: string;
  href?: string;
}

const PAGES: SearchResult[] = [
  // Core
  { type: 'page', label: 'Dashboard', sublabel: 'Home', href: '/' },
  { type: 'page', label: 'Wealth', sublabel: 'Net worth & assets', href: '/wealth' },
  // Markets
  { type: 'page', label: 'News', sublabel: 'Market news', href: '/news' },
  { type: 'page', label: 'Watchlist', sublabel: 'Tracked symbols', href: '/watchlist' },
  { type: 'page', label: 'Sectors', sublabel: 'Sector heatmap', href: '/sectors' },
  { type: 'page', label: 'Calendar', sublabel: 'Economic calendar', href: '/calendar' },
  // Trading
  { type: 'page', label: 'Trading', sublabel: 'Place orders', href: '/trading' },
  { type: 'page', label: 'Options Screener', sublabel: 'Screen options chains', href: '/trading/options/screener' },
  { type: 'page', label: 'Stock Screener', sublabel: 'Filter stocks', href: '/screener' },
  { type: 'page', label: 'Strategies', sublabel: 'Automated strategies', href: '/strategies' },
  { type: 'page', label: 'Backtest', sublabel: 'Test strategies historically', href: '/backtest' },
  { type: 'page', label: 'Journal', sublabel: 'Trade journal', href: '/journal' },
  // Empire
  { type: 'page', label: 'Territories', sublabel: 'CR3 territory map', href: '/territories' },
  { type: 'page', label: 'Cash Flow', sublabel: 'Revenue & expenses', href: '/cashflow' },
  { type: 'page', label: 'Tax Center', sublabel: 'Tax planning', href: '/tax' },
  // Alpha Engine
  { type: 'page', label: 'Signal Scanner', sublabel: 'Alpha signals', href: '/scanner' },
  { type: 'page', label: 'Options Flow', sublabel: 'Unusual activity', href: '/flow' },
  { type: 'page', label: 'Insider Tracker', sublabel: 'Insider transactions', href: '/insider' },
  { type: 'page', label: 'Earnings Intel', sublabel: 'Earnings calendar', href: '/earnings' },
  { type: 'page', label: 'P&L Simulator', sublabel: 'Simulate positions', href: '/simulator' },
  // Quant Lab
  { type: 'page', label: 'GEX Levels', sublabel: 'Gamma exposure', href: '/gex' },
  { type: 'page', label: 'Vol Surface', sublabel: 'Volatility surface', href: '/vol-surface' },
  { type: 'page', label: 'Pairs Trading', sublabel: 'Statistical pairs', href: '/pairs' },
  { type: 'page', label: 'Drift Regime', sublabel: 'Market regime detection', href: '/drift' },
  { type: 'page', label: 'Macro Regime', sublabel: 'Macro indicators', href: '/macro' },
  { type: 'page', label: 'Optimizer', sublabel: 'Portfolio optimizer', href: '/optimizer' },
  { type: 'page', label: 'Trading Crew', sublabel: 'Multi-agent crew', href: '/crew' },
  { type: 'page', label: 'Auto-Pilot', sublabel: 'Automated trading', href: '/autopilot' },
  // Intelligence
  { type: 'page', label: 'Risk', sublabel: 'Risk dashboard', href: '/risk' },
  { type: 'page', label: 'Monte Carlo', sublabel: 'Simulations', href: '/monte-carlo' },
  { type: 'page', label: 'Alerts', sublabel: 'Price & event alerts', href: '/alerts' },
  { type: 'page', label: 'Keisha AI', sublabel: 'AI advisor', href: '/keisha' },
  { type: 'page', label: 'Guard Test', sublabel: 'Risk guard testing', href: '/guard-test' },
  // Settings
  { type: 'page', label: 'Settings', sublabel: 'App settings', href: '/settings' },
];

/** Simple fuzzy match: checks if all characters of the query appear in order within the target */
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring match gets highest score
  if (t.includes(q)) return { match: true, score: 2 };

  // Fuzzy: all query chars appear in order
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return { match: true, score: 1 };

  return { match: false, score: 0 };
}

export default function CommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [stockResults, setStockResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (query.length < 1) {
      setStockResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/alpaca/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setStockResults(
            (data.results || []).slice(0, 5).map((r: { symbol: string; name: string }) => ({
              type: 'stock' as const,
              label: r.symbol,
              sublabel: r.name,
              href: `/stock/${r.symbol}`,
            }))
          );
        }
      } catch {
        // Ignore
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const updateResults = useCallback(() => {
    if (!query) {
      setResults([...stockResults, ...PAGES]);
      setSelectedIdx(0);
      return;
    }
    const scored = PAGES.map(p => {
      const labelMatch = fuzzyMatch(query, p.label);
      const subMatch = p.sublabel ? fuzzyMatch(query, p.sublabel) : { match: false, score: 0 };
      const bestScore = Math.max(labelMatch.score, subMatch.score);
      return { page: p, match: labelMatch.match || subMatch.match, score: bestScore };
    })
      .filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .map(r => r.page);
    setResults([...stockResults, ...scored]);
    setSelectedIdx(0);
  }, [query, stockResults]);

  useEffect(() => {
    updateResults();
  }, [updateResults]);

  const handleSelect = (result: SearchResult) => {
    if (result.href) {
      router.push(result.href);
    }
    setIsOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      handleSelect(results[selectedIdx]);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 120,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={() => { setIsOpen(false); setQuery(''); }}
      />

      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: 560,
        background: '#1a1a2e',
        borderRadius: 16,
        border: '1px solid rgba(138, 92, 246, 0.3)',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 40px rgba(138, 92, 246, 0.1)',
        overflow: 'hidden',
        maxHeight: '70vh',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: 10,
        }}>
          <span style={{ color: '#8a5cf6', fontSize: 18, fontFamily: "'JetBrains Mono', monospace" }}>{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search stocks, pages, or type a command..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            background: 'rgba(255,255,255,0.06)',
            color: '#666',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
          }}>
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 0' }}>
          {results.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 14 }}>
              No results found
            </div>
          ) : (
            results.map((result, i) => (
              <div
                key={`${result.type}-${result.label}`}
                onClick={() => handleSelect(result)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: i === selectedIdx ? 'rgba(138, 92, 246, 0.12)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  background: result.type === 'stock'
                    ? 'rgba(240, 198, 116, 0.15)'
                    : 'rgba(138, 92, 246, 0.15)',
                  color: result.type === 'stock' ? '#f0c674' : '#c4a6ff',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {result.type === 'stock' ? '$' : '\u2192'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 500 }}>
                    {result.label}
                  </div>
                  {result.sublabel && (
                    <div style={{ color: '#666', fontSize: 12, marginTop: 1 }}>
                      {result.sublabel}
                    </div>
                  )}
                </div>
                <span style={{
                  color: '#555',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {result.type}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: 16,
          fontSize: 11,
          color: '#555',
        }}>
          <span>{'\u2191\u2193'} Navigate</span>
          <span>{'\u21b5'} Select</span>
          <span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}
