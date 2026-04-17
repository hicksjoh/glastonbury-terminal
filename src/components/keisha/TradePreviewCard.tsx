'use client';

import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { useRouter } from 'next/navigation';
import type { TradePreviewCardData } from '@/types/keisha';

export function TradePreviewCard({ data }: { data: TradePreviewCardData }) {
  const router = useRouter();
  const credit = data.net_debit_credit < 0;
  const structureColor = credit ? '#4ade80' : '#f0c674';

  const openInTrading = () => {
    const params = new URLSearchParams({
      ticker: data.ticker,
      structure: 'multi-leg',
      source: 'keisha-widget',
      legs: JSON.stringify(data.legs),
    });
    router.push(`/trading?${params.toString()}`);
  };

  return (
    <div style={{ padding: 14, marginTop: 8, background: 'rgba(255,255,255,0.03)', border: `2px solid ${structureColor}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: structureColor, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>
            Trade Preview · {data.legs.length}-leg
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8', fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
            {data.ticker} · {credit ? 'Credit' : 'Debit'} ${Math.abs(data.net_debit_credit).toFixed(2)}
          </div>
        </div>
        <button onClick={openInTrading}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: structureColor, border: 'none', borderRadius: 8, color: '#080b14', cursor: 'pointer' }}>
          Review in /trading →
        </button>
      </div>

      {/* Leg table */}
      <div style={{ marginBottom: 10 }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#555', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>Action</th>
              <th style={{ padding: '4px 6px' }}>Type</th>
              <th style={{ padding: '4px 6px' }}>Strike</th>
              <th style={{ padding: '4px 6px' }}>Expiry</th>
              <th style={{ padding: '4px 6px' }}>Qty</th>
              <th style={{ padding: '4px 6px' }}>Price</th>
            </tr>
          </thead>
          <tbody>
            {data.legs.map((l, i) => (
              <tr key={i} style={{ borderTop: '1px solid #222' }}>
                <td style={{ padding: '4px 6px', color: l.action === 'buy' ? '#4ade80' : '#f87171', fontWeight: 700 }}>{l.action.toUpperCase()}</td>
                <td style={{ padding: '4px 6px', color: '#aaa' }}>{l.type}</td>
                <td style={{ padding: '4px 6px', fontFamily: "'JetBrains Mono', monospace" }}>{l.strike ?? '—'}</td>
                <td style={{ padding: '4px 6px', color: '#aaa' }}>{l.expiry ?? '—'}</td>
                <td style={{ padding: '4px 6px', color: '#e8e8e8' }}>{l.qty}</td>
                <td style={{ padding: '4px 6px', color: '#e8e8e8' }}>${l.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* P&L summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
        <div style={{ padding: 8, background: 'rgba(74,222,128,0.08)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase' }}>Max Profit</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
            {data.max_profit != null ? `$${data.max_profit.toFixed(0)}` : '∞'}
          </div>
        </div>
        <div style={{ padding: 8, background: 'rgba(248,113,113,0.08)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase' }}>Max Loss</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>
            {data.max_loss != null ? `$${data.max_loss.toFixed(0)}` : '∞'}
          </div>
        </div>
        <div style={{ padding: 8, background: 'rgba(240,198,116,0.08)', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase' }}>Breakeven</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f0c674' }}>
            {data.breakevens.length ? data.breakevens.map(b => `$${b.toFixed(2)}`).join(' / ') : '—'}
          </div>
        </div>
      </div>

      {/* Payoff curve */}
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.payoff_curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="price" stroke="#555" fontSize={10} />
            <YAxis stroke="#555" fontSize={10} />
            <Tooltip
              contentStyle={{ background: '#0a0a1a', border: '1px solid #333', fontSize: 11, borderRadius: 6 }}
              formatter={(v: number) => [`$${Number(v).toFixed(2)}`, 'P&L at expiry']}
              labelFormatter={v => `Price: $${Number(v).toFixed(2)}`}
            />
            <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="pnl" stroke={structureColor} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TradePreviewCard;
