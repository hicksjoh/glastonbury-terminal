'use client';

import { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { multiLegPayoff, multiLegCurrentValue } from '@/lib/options/greeks';
import { daysToExpiration } from '@/lib/options/symbols';

interface PayoffLeg {
  type: 'call' | 'put';
  strike: number;
  premium: number;
  quantity: number;
  isLong: boolean;
  expiration: string;
}

interface PayoffDiagramProps {
  legs: PayoffLeg[];
  currentPrice: number;
  templateName?: string;
}

export default function PayoffDiagram({ legs, currentPrice, templateName }: PayoffDiagramProps) {
  const [timeSlider, setTimeSlider] = useState(100); // 100% = at expiration

  const dte = legs[0]?.expiration ? daysToExpiration(legs[0].expiration) : 30;

  // Calculate payoff data
  const { expirationData, currentData, stats } = useMemo(() => {
    const expData = multiLegPayoff(legs, currentPrice, 0.25, 150);

    // Current value (with time value)
    const daysFromNow = Math.round(dte * (timeSlider / 100));
    const T = Math.max((dte - daysFromNow) / 365.25, 0.001);
    const sigma = 0.3; // Estimate
    const r = 0.05;

    const curData = timeSlider < 100
      ? multiLegCurrentValue(
          legs.map(l => ({ ...l, expiration: legs[0].expiration })),
          currentPrice, r, sigma, 0.25, 150
        )
      : expData;

    // Combine into chart data
    const chartData = expData.map((pt, i) => ({
      price: pt.price,
      expiration: pt.pnl,
      current: curData[i]?.pnl ?? pt.pnl,
    }));

    // Calculate stats
    const maxProfit = Math.max(...expData.map(d => d.pnl));
    const maxLoss = Math.min(...expData.map(d => d.pnl));
    const breakEvens = findBreakEvens(expData);

    // Net premium
    let netPremium = 0;
    for (const leg of legs) {
      const prem = leg.premium * leg.quantity * 100;
      netPremium += leg.isLong ? -prem : prem;
    }

    // Capital required (simplified)
    const strikes = legs.map(l => l.strike);
    const maxStrikeWidth = strikes.length >= 2 ? Math.max(...strikes) - Math.min(...strikes) : strikes[0] || 0;
    const capitalRequired = Math.abs(maxLoss) > 0 ? Math.abs(maxLoss) : maxStrikeWidth * 100;

    const probOfProfit = breakEvens.length > 0
      ? estimateProbOfProfit(expData, currentPrice)
      : 50;

    return {
      expirationData: chartData,
      currentData: curData,
      stats: {
        maxProfit,
        maxLoss,
        breakEvens,
        netPremium,
        capitalRequired,
        probOfProfit,
        riskReward: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : Infinity,
        roi: capitalRequired > 0 ? (maxProfit / capitalRequired) * 100 : 0,
        dte,
      },
    };
  }, [legs, currentPrice, timeSlider, dte]);

  // Find profit/loss zones for shading
  const maxY = Math.max(Math.abs(stats.maxProfit), Math.abs(stats.maxLoss)) * 1.1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8' }}>
            {templateName || 'Custom Strategy'}
          </div>
          <div style={{ fontSize: 11, color: '#6b6b80', marginTop: 2 }}>
            {legs.length} leg{legs.length !== 1 ? 's' : ''} &bull; {dte} DTE
          </div>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
          color: stats.netPremium >= 0 ? '#4ade80' : '#ef4444',
        }}>
          Net {stats.netPremium >= 0 ? 'Credit' : 'Debit'}: ${Math.abs(stats.netPremium).toFixed(0)}
        </div>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={expirationData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <defs>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a24" />
            <XAxis
              dataKey="price"
              type="number"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#6b6b80' }}
              tickFormatter={v => `$${v}`}
              stroke="#2a2a3a"
            />
            <YAxis
              domain={[-maxY, maxY]}
              tick={{ fontSize: 10, fill: '#6b6b80' }}
              tickFormatter={v => `$${v}`}
              stroke="#2a2a3a"
              width={60}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={{
                    background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 8,
                    padding: '8px 12px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    <div style={{ color: '#c9a84c', marginBottom: 4 }}>@ ${d.price.toFixed(2)}</div>
                    <div style={{ color: d.expiration >= 0 ? '#4ade80' : '#ef4444' }}>
                      Exp P&L: ${d.expiration.toFixed(0)}
                    </div>
                    {timeSlider < 100 && (
                      <div style={{ color: d.current >= 0 ? '#4ade80' : '#ef4444' }}>
                        Current P&L: ${d.current.toFixed(0)}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {/* Zero line */}
            <ReferenceLine y={0} stroke="#6b6b80" strokeDasharray="4 4" />
            {/* Current price */}
            <ReferenceLine x={currentPrice} stroke="#c9a84c" strokeDasharray="4 4"
              label={{ value: `$${currentPrice.toFixed(0)}`, position: 'top', fill: '#c9a84c', fontSize: 10 }} />
            {/* Break-even lines */}
            {stats.breakEvens.map((be, i) => (
              <ReferenceLine key={i} x={be} stroke="#f0c674" strokeDasharray="6 3"
                label={{ value: `BE $${be.toFixed(0)}`, position: 'insideTopRight', fill: '#f0c674', fontSize: 9 }} />
            ))}
            {/* At-expiration line */}
            <Area
              type="monotone"
              dataKey="expiration"
              stroke="#8a5cf6"
              strokeWidth={2}
              fill="url(#profitGrad)"
              dot={false}
              isAnimationActive={false}
            />
            {/* Current value line */}
            {timeSlider < 100 && (
              <Area
                type="monotone"
                dataKey="current"
                stroke="#c9a84c"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="none"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Time Slider */}
      <div style={{ padding: '12px 0 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 10, color: '#6b6b80', whiteSpace: 'nowrap' }}>Now</span>
        <input
          type="range"
          min={0}
          max={100}
          value={timeSlider}
          onChange={e => setTimeSlider(parseInt(e.target.value))}
          style={{
            flex: 1,
            accentColor: '#c9a84c',
            height: 4,
          }}
        />
        <span style={{ fontSize: 10, color: '#6b6b80', whiteSpace: 'nowrap' }}>Expiration</span>
        <span style={{
          fontSize: 10, color: '#c9a84c', fontFamily: "'JetBrains Mono', monospace",
          minWidth: 40, textAlign: 'right',
        }}>
          {Math.round(dte * (timeSlider / 100))}d
        </span>
      </div>

      {/* Stats Panel */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
        marginTop: 8,
        padding: 12,
        background: '#08080d',
        borderRadius: 8,
      }}>
        <StatCell label="Max Profit" value={`$${stats.maxProfit.toFixed(0)}`} color="#4ade80" />
        <StatCell label="Max Loss" value={isFinite(stats.maxLoss) ? `$${stats.maxLoss.toFixed(0)}` : 'Unlimited'} color="#ef4444" />
        <StatCell
          label="Break Even"
          value={stats.breakEvens.length > 0 ? stats.breakEvens.map(b => `$${b.toFixed(0)}`).join(' / ') : '—'}
          color="#f0c674"
        />
        <StatCell label="P(Profit)" value={`${stats.probOfProfit.toFixed(0)}%`} color={stats.probOfProfit > 50 ? '#4ade80' : '#ef4444'} />
        <StatCell label="Risk/Reward" value={isFinite(stats.riskReward) ? `1:${stats.riskReward.toFixed(2)}` : '—'} color="#c8c8d0" />
        <StatCell label="Capital Req." value={`$${stats.capitalRequired.toFixed(0)}`} color="#c8c8d0" />
        <StatCell label="ROI at Max" value={`${stats.roi.toFixed(0)}%`} color="#8a5cf6" />
        <StatCell label="DTE" value={`${stats.dte} days`} color={stats.dte < 7 ? '#f59e0b' : '#c8c8d0'} />
      </div>
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function findBreakEvens(data: { price: number; pnl: number }[]): number[] {
  const breakEvens: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if ((data[i - 1].pnl < 0 && data[i].pnl >= 0) || (data[i - 1].pnl >= 0 && data[i].pnl < 0)) {
      // Linear interpolation
      const x1 = data[i - 1].price, y1 = data[i - 1].pnl;
      const x2 = data[i].price, y2 = data[i].pnl;
      const be = x1 + (0 - y1) * (x2 - x1) / (y2 - y1);
      breakEvens.push(Math.round(be * 100) / 100);
    }
  }
  return breakEvens;
}

function estimateProbOfProfit(data: { price: number; pnl: number }[], currentPrice: number): number {
  // Simple estimate: % of price range where P&L > 0, weighted toward current price
  const profitable = data.filter(d => d.pnl > 0).length;
  return (profitable / data.length) * 100;
}
