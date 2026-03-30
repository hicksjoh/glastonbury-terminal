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
  { type: 'page', label: 'Dashboard', sublabel: 'Home', href: '/' },
  { type: 'page', label: 'News Feed', sublabel: 'Market news', href: '/news' },
  { type: 'page', label: 'Watchlist', sublabel: 'Tracked symbols', href: '/watchlist' },
  { type: 'page', label: 'Trading', sublabel: 'Place orders', href: '/trading' },
  { type: 'page', label: 'Strategies', sublabel: 'Automated strategies', href: '/strategies' },
  { type: 'page', label: 'Sectors', sublabel: 'Sector heatmap', href: '/sectors' },
  { type: 'page', label: 'Economic Calendar', sublabel: 'Macro events', href: '/calendar' },
  { type: 'page', label: 'Keisha AI', sublabel: 'AI advisor', href: '/keisha' },
  { type: 'page', label: 'Monte Carlo', sublabel: 'Simulations', href: '/monte-carlo' },
];

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
    const q = query.toLowerCase();
    const pageResults = q
      ? PAGES.filter(p => p.label.toLowerCase().includes(q) || p.sublabel?.toLowerCase().includes(q))
      : PAGES;
    setResults([...stockResults, ...pageResults]);
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
