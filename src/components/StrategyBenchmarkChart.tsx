'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface BenchmarkData {
  date: string;
  strategy: number;
  spy: number;
}

interface Props {
  strategyName: string;
  strategyType: string;
}

const TIME_PERIODS = ['1W', '1M', '3M', 'ALL'] as const;

export function StrategyBenchmarkChart({ strategyName, strategyType }: Props) {
  const [data, setData] = useState<BenchmarkData[]>([]);
  const [period, setPeriod] = useState<typeof TIME_PERIODS[number]>('1M');
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    const fetchBenchmark = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/strategies/benchmark?strategy=${encodeURIComponent(strategyType)}&period=${period}`);
        if (res.ok) {
          const result = await res.json();
          if (result.data && result.data.length > 0) {
            setData(result.data);
            setNoData(false);
          } else {
            setNoData(true);
          }
        } else {
          setNoData(true);
        }
      } catch {
        setNoData(true);
      } finally {
        setLoading(false);
      }
    };
    fetchBenchmark();
  }, [strategyType, period]);

  if (loading) {
    return <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>Loading benchmark...</div>;
  }

  if (noData) {
    return (
      <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginTop: 12 }}>
        <div style={{ color: '#555', fontSize: 12, textAlign: 'center' }}>
          No trade history — benchmark comparison will appear after first execution
        </div>
      </div>
    );
  }

  const alpha = data.length > 0 ? (data[data.length - 1].strategy - data[data.length - 1].spy).toFixed(2) : '0';

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: '#6b6b80' }}>vs SPY</span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: Number(alpha) >= 0 ? '#4ade80' : '#f87171',
            background: Number(alpha) >= 0 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
            padding: '2px 8px',
            borderRadius: 4,
          }}>
            Alpha: {Number(alpha) >= 0 ? '+' : ''}{alpha}%
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIME_PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                border: period === p ? '1px solid #c9a84c' : '1px solid transparent',
                background: period === p ? 'rgba(201, 168, 76, 0.1)' : 'transparent',
                color: period === p ? '#c9a84c' : '#555',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#888' }}
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: '#888' }} />
          <Line type="monotone" dataKey="strategy" stroke="#f0c674" strokeWidth={2} dot={false} name={strategyName} />
          <Line type="monotone" dataKey="spy" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="SPY" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
