'use client';

import { SkeletonCard, SkeletonTable } from '@/components/Skeleton';

/**
 * LoadingState — drop-in loading skeleton for terminal pages.
 * Replaces bare "Loading..." text with proper shimmer.
 */
export function LoadingState({
  variant = 'cards',
  rows = 3,
  cols = 4,
}: {
  variant?: 'cards' | 'table' | 'mixed';
  rows?: number;
  cols?: number;
}) {
  if (variant === 'table') {
    return (
      <div style={{ padding: 24 }}>
        <SkeletonTable rows={rows} cols={cols} />
      </div>
    );
  }

  if (variant === 'mixed') {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
            <SkeletonCard key={`card-${i}`} height={80} />
          ))}
        </div>
        <SkeletonTable rows={rows} cols={cols} />
      </div>
    );
  }

  // Default: cards
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} height={100} />
      ))}
    </div>
  );
}
