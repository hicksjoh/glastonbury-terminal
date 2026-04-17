'use client';

import { useRouter } from 'next/navigation';
import type { OrderTicketCardData } from '@/types/keisha';

export function OrderTicketCard({ data }: { data: OrderTicketCardData }) {
  const router = useRouter();
  const sideColor = data.side === 'buy' ? '#4ade80' : '#f87171';
  const estCost = (data.limit ?? data.last_price ?? 0) * data.qty;

  const openInTrading = () => {
    const params = new URLSearchParams({
      ticker: data.ticker,
      side: data.side,
      qty: String(data.qty),
      source: 'keisha-widget',
    });
    if (data.limit) params.set('limit', String(data.limit));
    router.push(`/trading?${params.toString()}`);
  };

  return (
    <div style={{
      padding: 14, marginTop: 8, background: 'rgba(255,255,255,0.03)',
      border: `2px solid ${sideColor}`, borderRadius: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: sideColor, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>
            Order Ticket · {data.paperMode ? 'paper' : 'live'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
            {data.side.toUpperCase()} {data.qty} {data.ticker}
          </div>
        </div>
        <button onClick={openInTrading}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: sideColor, border: 'none', borderRadius: 8, color: '#080b14', cursor: 'pointer' }}>
          Review in /trading →
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, fontSize: 12 }}>
        <div><span style={{ color: '#666' }}>Last:</span> <span style={{ color: '#e8e8e8', fontWeight: 700 }}>${data.last_price?.toFixed(2) ?? '—'}</span></div>
        <div><span style={{ color: '#666' }}>Limit:</span> <span style={{ color: '#f0c674', fontWeight: 700 }}>{data.limit ? `$${data.limit.toFixed(2)}` : 'market'}</span></div>
        <div><span style={{ color: '#666' }}>Est. value:</span> <span style={{ color: '#e8e8e8', fontWeight: 700 }}>${estCost.toFixed(0)}</span></div>
        {data.suggested_sizing?.halfKellyShares != null && (
          <div><span style={{ color: '#666' }}>½-Kelly qty:</span> <span style={{ color: '#8a5cf6', fontWeight: 700 }}>{data.suggested_sizing.halfKellyShares}</span></div>
        )}
      </div>
    </div>
  );
}

export default OrderTicketCard;
