'use client';

import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { MiniChartCardData } from '@/types/keisha';

export function MiniChartCard({ data }: { data: MiniChartCardData }) {
  const rows = data.closes.map((c, i) => ({ i, c }));
  const positive = data.change_pct >= 0;
  const color = positive ? '#4ade80' : '#f87171';

  return (
    <div style={{ padding: 12, marginTop: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(138,92,246,0.18)', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
            Mini Chart · {data.timeframe}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{data.ticker}</span>
            <span style={{ fontSize: 14, color: '#e8e8e8', fontWeight: 700 }}>${data.last.toFixed(2)}</span>
            <span style={{ fontSize: 12, color, fontWeight: 700 }}>{positive ? '+' : ''}{data.change_pct.toFixed(2)}%</span>
          </div>
        </div>
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Tooltip
              contentStyle={{ background: '#0a0a1a', border: '1px solid #333', fontSize: 11, borderRadius: 6 }}
              labelFormatter={() => ''}
              formatter={(v: number) => [`$${Number(v).toFixed(2)}`, data.ticker]}
            />
            <Line type="monotone" dataKey="c" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default MiniChartCard;
