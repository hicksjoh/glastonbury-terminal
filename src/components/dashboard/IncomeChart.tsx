'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { INCOME_STREAM_DATA } from '@/lib/data';

function formatK(v: number) { return `$${(v / 1000).toFixed(0)}K`; }

export function IncomeChart() {
  return (
    <div className="terminal-card">
      <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Income Streams &mdash; 2026</div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={INCOME_STREAM_DATA} barSize={20}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="month" tick={{ fill: '#6b6b80', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatK} tick={{ fill: '#6b6b80', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v: number) => formatK(v)}
            contentStyle={{ backgroundColor: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8 }}
            labelStyle={{ color: '#e8e8e8' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#6b6b80' }} />
          <Bar dataKey="cr3" name="CR3" stackId="a" fill="#22c55e" />
          <Bar dataKey="anthropic" name="Anthropic" stackId="a" fill="#818cf8" />
          <Bar dataKey="dividends" name="Dividends" stackId="a" fill="#38bdf8" />
          <Bar dataKey="options" name="Options" stackId="a" fill="#c9a84c" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
