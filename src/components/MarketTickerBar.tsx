'use client';

import { useEffect, useState, useRef } from 'react';

interface TickerItem {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
}

const FLASH_THRESHOLD = 0.5; // Flash when change exceeds 0.5%

export default function MarketTickerBar() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashSymbols, setFlashSymbols] = useState<Set<string>>(new Set());
  const prevPricesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const res = await fetch('/api/market-ticker');
        if (res.ok) {
          const data = await res.json();
          const newTickers: TickerItem[] = data.tickers || [];

          // Detect significant price moves for flash animation
          const newFlashes = new Set<string>();
          for (const t of newTickers) {
            const prev = prevPricesRef.current[t.symbol];
            if (prev !== undefined && prev !== 0) {
              const movePct = Math.abs(((t.price - prev) / prev) * 100);
              if (movePct >= FLASH_THRESHOLD) {
                newFlashes.add(t.symbol);
              }
            }
            prevPricesRef.current[t.symbol] = t.price;
          }

          if (newFlashes.size > 0) {
            setFlashSymbols(newFlashes);
            setTimeout(() => setFlashSymbols(new Set()), 1200);
          }

          setTickers(newTickers);
        }
      } catch (err) {
        console.error('Ticker fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTickers();
    const interval = setInterval(fetchTickers, 10000); // 10-second refresh
    return () => clearInterval(interval);
  }, []);

  // When we have no tickers (loading or empty response), avoid saying
  // "Markets closed" here — the Market Pulse card already conveys that,
  // and the duplicate message reads like a bug.
  if (loading || tickers.length === 0) {
    return (
      <div style={{
        height: 36,
        background: 'rgba(0, 0, 0, 0.6)',
        borderBottom: '1px solid rgba(138, 92, 246, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: '#666',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {loading ? 'Loading market data\u2026' : 'Live quotes unavailable'}
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes priceFlash {
          0% { background: rgba(138, 92, 246, 0.3); }
          50% { background: rgba(138, 92, 246, 0.15); }
          100% { background: transparent; }
        }
        .ticker-flash {
          animation: priceFlash 1.2s ease-out;
        }
      `}</style>
      <div aria-label="Market status" role="status" style={{
        height: 36,
        background: 'rgba(0, 0, 0, 0.6)',
        borderBottom: '1px solid rgba(138, 92, 246, 0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        whiteSpace: 'nowrap',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        scrollbarWidth: 'none',
      }}>
        {tickers.map((t, i) => (
          <div
            key={t.symbol}
            className={flashSymbols.has(t.symbol) ? 'ticker-flash' : ''}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 16px',
              borderRight: i < tickers.length - 1 ? '1px solid rgba(138, 92, 246, 0.15)' : 'none',
              flexShrink: 0,
              borderRadius: 4,
              transition: 'background 0.3s',
            }}
          >
            <span style={{ color: '#888', fontWeight: 500 }}>{t.label}</span>
            <span style={{ color: '#d0d0e0', fontWeight: 600 }}>
              {t.price >= 1000 ? t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.price.toFixed(2)}
            </span>
            <span style={{
              color: t.change >= 0 ? '#4ade80' : '#f87171',
              fontWeight: 500,
            }}>
              {t.change >= 0 ? '+' : ''}{t.changePercent.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
