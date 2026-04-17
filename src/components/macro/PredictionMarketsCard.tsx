'use client';

import { useCallback, useEffect, useState } from 'react';

type Snapshot = {
  source: 'kalshi' | 'polymarket';
  market_ticker: string;
  market_name: string;
  yes_price: number | null;
  no_price: number | null;
  volume_24h: number | null;
  delta_24h: number | null;
  category: string | null;
  snapshot_at: string;
};

function SourceBadge({ source }: { source: 'kalshi' | 'polymarket' }) {
  const color = source === 'kalshi' ? '#f0c674' : '#22d3ee';
  return (
    <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 9, background: `${color}22`, color, fontWeight: 700, textTransform: 'uppercase' }}>
      {source}
    </span>
  );
}

export function PredictionMarketsCard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/prediction/list');
      const body = await res.json();
      setSnapshots(body.snapshots ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/cron/prediction-snapshot');
      await load();
    } finally { setRefreshing(false); }
  };

  return (
    <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.15)', borderRadius: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Prediction Markets
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
            Kalshi + Polymarket · refreshes every 5 min
          </div>
        </div>
        <button onClick={refresh} disabled={refreshing}
          style={{ background: 'none', border: '1px solid #333', color: refreshing ? '#333' : '#888', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: refreshing ? 'wait' : 'pointer' }}>
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: '#666', padding: 20, textAlign: 'center' }}>Loading…</div>
      ) : snapshots.length === 0 ? (
        <div style={{ fontSize: 12, color: '#666', padding: 20, textAlign: 'center' }}>
          No snapshots yet. Click Refresh to pull the first one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
          {snapshots.map(s => {
            const yes = s.yes_price ?? 0;
            const yesPct = Math.round(yes * 100);
            const delta = s.delta_24h ?? 0;
            const deltaPct = Math.round(delta * 100);
            const deltaColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#888';
            return (
              <div key={s.market_ticker} style={{ padding: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid #222', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <SourceBadge source={s.source} />
                  {s.category && (
                    <span style={{ fontSize: 9, color: '#666' }}>{s.category}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#d0d0e0', lineHeight: 1.3, marginBottom: 6, minHeight: 28 }}>
                  {s.market_name.length > 100 ? s.market_name.slice(0, 100) + '…' : s.market_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: yes > 0.5 ? '#4ade80' : '#f87171' }}>
                    {yesPct}%
                  </span>
                  <span style={{ fontSize: 10, color: '#888' }}>yes</span>
                  {s.delta_24h != null && (
                    <span style={{ fontSize: 11, color: deltaColor, fontWeight: 700, marginLeft: 'auto' }}>
                      {deltaPct > 0 ? '+' : ''}{deltaPct}pp 24h
                    </span>
                  )}
                </div>
                {s.volume_24h != null && (
                  <div style={{ fontSize: 9, color: '#555', marginTop: 4 }}>
                    24h vol ${s.volume_24h >= 1_000_000 ? (s.volume_24h / 1_000_000).toFixed(1) + 'M' : (s.volume_24h / 1000).toFixed(0) + 'k'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
