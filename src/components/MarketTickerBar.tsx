'use client';

import { useEffect, useState } from 'react';

interface TickerItem {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
}

export default function MarketTickerBar() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const res = await fetch('/api/market-ticker');
        if (res.ok) {
          const data = await res.json();
          setTickers(data.tickers || []);
        }
      } catch (err) {
        console.error('Ticker fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTickers();
    const interval = setInterval(fetchTickers, 60000);
    return () => clearInterval(interval);
  }, []);

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
        {loading ? 'Loading market data...' : 'Markets closed'}
      </div>
    );
  }

  return (
    <div style={{
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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            borderRight: i < tickers.length - 1 ? '1px solid rgba(138, 92, 246, 0.15)' : 'none',
            flexShrink: 0,
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
  );
}
