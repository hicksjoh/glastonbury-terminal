'use client';

import { useEffect, useRef, useState } from 'react';

interface PortfolioPoint {
  timestamp: number;
  equity: number;
  profit_loss: number;
  profit_loss_pct: number;
}

export default function PortfolioChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PortfolioPoint[]>([]);
  const [timeframe, setTimeframe] = useState('1M');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/portfolio-history?period=${timeframe}`);
        if (res.ok) {
          const result = await res.json();
          setData(result.history || []);
        }
      } catch (err) {
        console.error('Portfolio history error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [timeframe]);

  useEffect(() => {
    if (!data.length || !chartRef.current) return;

    let chart: ReturnType<typeof import('lightweight-charts').createChart> | null = null;

    import('lightweight-charts').then((mod) => {
      if (!chartRef.current) return;
      chartRef.current.innerHTML = '';

      chart = mod.createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 250,
        layout: {
          background: { type: mod.ColorType.Solid, color: 'transparent' },
          textColor: '#888',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: 'rgba(138, 92, 246, 0.06)' },
          horzLines: { color: 'rgba(138, 92, 246, 0.06)' },
        },
        crosshair: {
          vertLine: { color: 'rgba(138, 92, 246, 0.4)', style: mod.LineStyle.Dashed },
          horzLine: { color: 'rgba(138, 92, 246, 0.4)', style: mod.LineStyle.Dashed },
        },
        rightPriceScale: { borderColor: 'rgba(138, 92, 246, 0.15)' },
        timeScale: { borderColor: 'rgba(138, 92, 246, 0.15)' },
      });

      const isPositive = data[data.length - 1]?.profit_loss_pct >= 0;

      const areaSeries = chart.addSeries(mod.AreaSeries, {
        lineColor: isPositive ? '#4ade80' : '#f87171',
        topColor: isPositive ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)',
        bottomColor: isPositive ? 'rgba(74, 222, 128, 0.02)' : 'rgba(248, 113, 113, 0.02)',
        lineWidth: 2,
      });

      areaSeries.setData(
        data.map(p => ({
          time: Math.floor(p.timestamp / 1000) as unknown as string,
          value: p.equity,
        }))
      );

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (chartRef.current && chart) {
          chart.applyOptions({ width: chartRef.current.clientWidth });
        }
      });
      ro.observe(chartRef.current);
    });

    return () => { chart?.remove(); };
  }, [data]);

  const lastPoint = data[data.length - 1];
  const firstPoint = data[0];
  const totalChange = lastPoint && firstPoint ? lastPoint.equity - firstPoint.equity : 0;
  const totalPct = firstPoint ? (totalChange / firstPoint.equity) * 100 : 0;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.06)',
      padding: 20,
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Portfolio Value
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: '#fff', fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              ${lastPoint?.equity?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '-'}
            </span>
            {totalChange !== 0 && (
              <span style={{
                color: totalChange >= 0 ? '#4ade80' : '#f87171',
                fontSize: 14,
                fontWeight: 600,
              }}>
                {totalChange >= 0 ? '+' : ''}${totalChange.toFixed(2)} ({totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['1W', '1M', '3M', '1Y', 'ALL'].map(p => (
            <button
              key={p}
              onClick={() => setTimeframe(p)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: timeframe === p ? '1px solid #8a5cf6' : '1px solid transparent',
                background: timeframe === p ? 'rgba(138, 92, 246, 0.15)' : 'transparent',
                color: timeframe === p ? '#c4a6ff' : '#666',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Loading portfolio history...
        </div>
      ) : data.length === 0 ? (
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          No portfolio history available
        </div>
      ) : (
        <div ref={chartRef} style={{ width: '100%', height: 250 }} />
      )}
    </div>
  );
}
