'use client';

import React from 'react';

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default React.memo(function SparklineChart({
  data,
  width = 120,
  height = 30,
  color,
}: SparklineChartProps) {
  const uid = React.useId().replace(/:/g, '');

  if (!data || data.length < 2) {
    return (
      <div
        style={{
          width,
          height,
          opacity: 0.3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          color: '#555',
        }}
      >
        --
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const lineColor = color ?? (data[data.length - 1] > data[0] ? '#22c55e' : '#ef4444');
  const gradientId = `sparkline-grad-${uid}`;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Build the closed polygon for the gradient fill area
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const fillPoints = [
    ...points.map(p => `${p.x},${p.y}`),
    `${lastPt.x},${height - padding}`,
    `${firstPt.x},${height - padding}`,
  ].join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradientId})`} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
