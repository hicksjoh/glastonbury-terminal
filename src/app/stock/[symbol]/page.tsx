'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/LoadingState';

interface StockData {
  profile: {
    symbol: string;
    companyName: string;
    price: number;
    change: number;
    changePercentage: number;
    marketCap: number;
    sector: string;
    industry: string;
    beta: number;
    exchange: string;
    description: string;
    ipoDate: string;
  } | null;
  quote: {
    price: number;
    change: number;
    changePercentage: number;
    dayHigh: number;
    dayLow: number;
    yearHigh: number;
    yearLow: number;
    volume: number;
    avgVolume: number;
    open: number;
    previousClose: number;
    eps: number;
    pe: number;
    marketCap: number;
    earningsAnnouncement: string;
  } | null;
  historicalPrices: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  news: { headline: string; source: string; url: string; created_at: string; symbols: string[] }[];
}

type TimeRange = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';
type ChartType = 'candlestick' | 'line' | 'area';

export default function StockDetailPage() {
  const params = useParams();
  const symbol = (params.symbol as string)?.toUpperCase();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('3M');
  const [chartType, setChartType] = useState<ChartType>('candlestick');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/stock/${symbol}?range=${timeRange}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (err) {
      console.error('Stock fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeRange]);

  useEffect(() => {
    if (symbol) fetchData();
  }, [symbol, fetchData]);

  // Chart rendering
  useEffect(() => {
    if (!data?.historicalPrices?.length || !chartContainerRef.current) return;

    let chart: ReturnType<typeof import('lightweight-charts').createChart> | null = null;
    const container = chartContainerRef.current;

    import('lightweight-charts').then((mod) => {
      if (!container) return;
      container.innerHTML = '';

      chart = mod.createChart(container, {
        width: container.clientWidth,
        height: 400,
        layout: {
          background: { type: mod.ColorType.Solid, color: 'transparent' },
          textColor: '#888',
          fontSize: 12,
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
        timeScale: {
          borderColor: 'rgba(138, 92, 246, 0.15)',
          timeVisible: timeRange === '1D',
        },
        rightPriceScale: {
          borderColor: 'rgba(138, 92, 246, 0.15)',
        },
      });

      const isIntraday = timeRange === '1D';

      // Determine which series type to render
      const effectiveChartType = isIntraday && chartType === 'candlestick' ? 'area' : chartType;

      if (effectiveChartType === 'candlestick') {
        const candleSeries = chart.addSeries(mod.CandlestickSeries, {
          upColor: '#4ade80',
          downColor: '#f87171',
          borderUpColor: '#4ade80',
          borderDownColor: '#f87171',
          wickUpColor: '#4ade80',
          wickDownColor: '#f87171',
        });
        candleSeries.setData(
          data!.historicalPrices.map(p => ({
            time: p.time,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
          }))
        );
      } else if (effectiveChartType === 'line') {
        const lineSeries = chart.addSeries(mod.LineSeries, {
          color: '#8a5cf6',
          lineWidth: 2,
        });
        lineSeries.setData(
          data!.historicalPrices.map(p => ({
            time: isIntraday ? (parseInt(p.time) as unknown as string) : p.time,
            value: p.close,
          }))
        );
      } else {
        // area
        const areaSeries = chart.addSeries(mod.AreaSeries, {
          lineColor: '#8a5cf6',
          topColor: 'rgba(138, 92, 246, 0.3)',
          bottomColor: 'rgba(138, 92, 246, 0.02)',
          lineWidth: 2,
        });
        areaSeries.setData(
          data!.historicalPrices.map(p => ({
            time: isIntraday ? (parseInt(p.time) as unknown as string) : p.time,
            value: p.close,
          }))
        );
      }

      // Volume bars - color coded green/red
      const volumeSeries = chart.addSeries(mod.HistogramSeries, {
        color: 'rgba(138, 92, 246, 0.2)',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(
        data!.historicalPrices.map(p => ({
          time: isIntraday ? (parseInt(p.time) as unknown as string) : p.time,
          value: p.volume,
          color: p.close >= p.open ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)',
        }))
      );

      chart.timeScale().fitContent();

      const resizeObserver = new ResizeObserver(() => {
        if (container && chart) {
          chart.applyOptions({ width: container.clientWidth });
        }
      });
      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
      };
    });

    return () => {
      chart?.remove();
    };
  }, [data, timeRange, chartType]);

  if (loading) {
    return (
      <AppShell>
        <LoadingState variant="mixed" rows={4} cols={4} />
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <div style={{ textAlign: 'center', padding: 100, color: '#666' }}>No data found for {symbol}</div>
      </AppShell>
    );
  }

  const { profile, quote } = data;
  const price = quote?.price || profile?.price || 0;
  const change = quote?.change || profile?.change || 0;
  const changePct = quote?.changePercentage || profile?.changePercentage || 0;
  const isUp = change >= 0;

  const formatNum = (n: number | undefined | null) => {
    if (n == null) return '-';
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n.toLocaleString()}`;
  };

  const StatBox = ({ label, value }: { label: string; value: string }) => (
    <div style={{ padding: '10px 0' }}>
      <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#d0d0e0', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );

  const timeRanges: TimeRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'];
  const chartTypes: { key: ChartType; label: string }[] = [
    { key: 'candlestick', label: 'Candle' },
    { key: 'line', label: 'Line' },
    { key: 'area', label: 'Area' },
  ];

  return (
    <ErrorBoundary label="StockDetail">
    <AppShell>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
              {symbol}
            </h1>
            <span style={{ color: '#888', fontSize: 16 }}>{profile?.companyName}</span>
            {profile?.exchange && (
              <span style={{
                background: 'rgba(138, 92, 246, 0.15)',
                color: '#c4a6ff',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
              }}>
                {profile.exchange}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}>
              ${price.toFixed(2)}
            </span>
            <span style={{
              fontSize: 20,
              fontWeight: 600,
              color: isUp ? '#4ade80' : '#f87171',
            }}>
              {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
            </span>
          </div>
          {profile?.sector && (
            <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
              {profile.sector} &bull; {profile.industry}
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.06)',
          padding: 20,
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {timeRanges.map(r => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    border: timeRange === r ? '1px solid #8a5cf6' : '1px solid rgba(255,255,255,0.08)',
                    background: timeRange === r ? 'rgba(138, 92, 246, 0.2)' : 'transparent',
                    color: timeRange === r ? '#c4a6ff' : '#666',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 2 }}>
              {chartTypes.map(ct => (
                <button
                  key={ct.key}
                  onClick={() => setChartType(ct.key)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: chartType === ct.key ? 'rgba(138, 92, 246, 0.2)' : 'transparent',
                    color: chartType === ct.key ? '#c4a6ff' : '#555',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>
          <div ref={chartContainerRef} style={{ width: '100%', height: 400 }} />
        </div>

        {/* Stats Grid + News */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Key Stats */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            padding: 20,
          }}>
            <h3 style={{ color: '#f0c674', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px' }}>
              Key Statistics
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <StatBox label="Market Cap" value={formatNum(quote?.marketCap)} />
              <StatBox label="P/E Ratio" value={quote?.pe ? quote.pe.toFixed(1) : '-'} />
              <StatBox label="EPS" value={quote?.eps ? `$${quote.eps.toFixed(2)}` : '-'} />
              <StatBox label="Beta" value={profile?.beta ? profile.beta.toFixed(2) : '-'} />
              <StatBox label="52W High" value={quote?.yearHigh ? `$${quote.yearHigh.toFixed(2)}` : '-'} />
              <StatBox label="52W Low" value={quote?.yearLow ? `$${quote.yearLow.toFixed(2)}` : '-'} />
              <StatBox label="Open" value={quote?.open ? `$${quote.open.toFixed(2)}` : '-'} />
              <StatBox label="Prev Close" value={quote?.previousClose ? `$${quote.previousClose.toFixed(2)}` : '-'} />
              <StatBox label="Volume" value={quote?.volume ? `${(quote.volume / 1e6).toFixed(1)}M` : '-'} />
              <StatBox label="Avg Volume" value={quote?.avgVolume ? `${(quote.avgVolume / 1e6).toFixed(1)}M` : '-'} />
              <StatBox label="Day Range" value={quote ? `$${quote.dayLow.toFixed(0)} - $${quote.dayHigh.toFixed(0)}` : '-'} />
              <StatBox label="IPO Date" value={profile?.ipoDate || '-'} />
            </div>
          </div>

          {/* Recent News */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            padding: 20,
          }}>
            <h3 style={{ color: '#f0c674', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px' }}>
              Recent News
            </h3>
            {data.news.length === 0 ? (
              <div style={{ color: '#555', fontSize: 13, padding: 20, textAlign: 'center' }}>No recent news</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.news.slice(0, 8).map((n, i) => (
                  <a
                    key={i}
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textDecoration: 'none',
                      padding: '8px 0',
                      borderBottom: i < 7 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}
                  >
                    <div style={{ fontSize: 13, color: '#d0d0e0', lineHeight: 1.4, marginBottom: 4 }}>
                      {n.headline}
                    </div>
                    <div style={{ fontSize: 11, color: '#666' }}>
                      {n.source} &bull; {new Date(n.created_at).toLocaleDateString()}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {profile?.description && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            padding: 20,
            marginTop: 24,
          }}>
            <h3 style={{ color: '#f0c674', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
              About {profile.companyName}
            </h3>
            <p style={{ color: '#888', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              {profile.description.slice(0, 500)}{profile.description.length > 500 ? '...' : ''}
            </p>
          </div>
        )}
      </div>
    </AppShell>
    </ErrorBoundary>
  );
}
