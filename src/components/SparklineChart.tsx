'use client';

import React from 'react';

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
}

export const SparklineChart = React.memo(function SparklineChart({ data, width = 100, height = 40 }: SparklineChartProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height, opacity: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#555' }}>--</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const isUp = data[data.length - 1] > data[0];
  const color = isUp ? '#22c55e' : '#ef4444';

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
