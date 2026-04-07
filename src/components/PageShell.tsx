'use client';

import { ReactNode, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SkeletonCard } from '@/components/Skeleton';

/**
 * PageShell — standard wrapper for every terminal page.
 * Provides: ErrorBoundary + Suspense loading skeleton.
 *
 * Usage:
 *   <PageShell label="Watchlist">
 *     <WatchlistContent />
 *   </PageShell>
 */
export function PageShell({
  children,
  label,
  loadingRows = 3,
}: {
  children: ReactNode;
  label?: string;
  loadingRows?: number;
}) {
  return (
    <ErrorBoundary label={label}>
      <Suspense
        fallback={
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: loadingRows }).map((_, i) => (
              <SkeletonCard key={i} height={100} />
            ))}
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
