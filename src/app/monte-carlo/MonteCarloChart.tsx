'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ChartDataPoint {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export default function MonteCarloChart({ data }: { data: ChartDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          {(['p90', 'p75', 'p50', 'p25', 'p10'] as const).map((p, i) => (
            <linearGradient key={p} id={`g${p}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c9a84c" stopOpacity={0.15 - i * 0.02} />
              <stop offset="95%" stopColor="#c9a84c" stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
        <XAxis dataKey="year" tick={{ fill: '#6b6b80', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={v => `$${v.toFixed(0)}M`}
          tick={{ fill: '#6b6b80', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(v: number) => [`$${v.toFixed(1)}M`]}
          contentStyle={{ backgroundColor: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8 }}
          labelStyle={{ color: '#e8e8e8' }}
        />
        <Area type="monotone" dataKey="p90" stroke="#c9a84c" strokeWidth={1} fill="url(#gp90)" strokeOpacity={0.4} name="90th %ile" />
        <Area type="monotone" dataKey="p75" stroke="#c9a84c" strokeWidth={1.5} fill="url(#gp75)" strokeOpacity={0.6} name="75th %ile" />
        <Area type="monotone" dataKey="p50" stroke="#c9a84c" strokeWidth={2.5} fill="url(#gp50)" name="Median" />
        <Area type="monotone" dataKey="p25" stroke="#c9a84c" strokeWidth={1.5} fill="url(#gp25)" strokeOpacity={0.6} name="25th %ile" />
        <Area type="monotone" dataKey="p10" stroke="#c9a84c" strokeWidth={1} fill="url(#gp10)" strokeOpacity={0.4} name="10th %ile" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
