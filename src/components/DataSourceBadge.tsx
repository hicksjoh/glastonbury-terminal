'use client';

import { type ApiMeta } from '@/lib/api-meta';

interface DataSourceBadgeProps {
  meta?: ApiMeta | null;
  size?: 'sm' | 'md';
  showSource?: boolean;
}

export function DataSourceBadge({ meta, size = 'sm', showSource = false }: DataSourceBadgeProps) {
  if (!meta) {
    return (
      <span className={`inline-flex items-center gap-1 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
        <span className="w-2 h-2 rounded-full bg-zinc-500" />
        <span className="text-zinc-500">No data</span>
      </span>
    );
  }

  let color: string;
  let label: string;

  if (meta.live && !meta.stale) {
    color = 'bg-emerald-500';
    label = 'Live';
  } else if (meta.live && meta.stale) {
    color = 'bg-yellow-500';
    label = 'Stale';
  } else if (meta.cached) {
    color = 'bg-blue-500';
    label = 'Cached';
  } else {
    color = 'bg-red-500';
    label = 'Fallback';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
      <span className={meta.live ? 'text-emerald-400' : 'text-red-400'}>{label}</span>
      {showSource && meta.source && (
        <span className="text-zinc-500">({meta.source})</span>
      )}
    </span>
  );
}

// Compact version for use in page headers
export function DataSourceIndicator({ meta }: { meta?: ApiMeta | null }) {
  if (!meta) return null;

  const color = meta.live && !meta.stale
    ? 'bg-emerald-500'
    : meta.stale
    ? 'bg-yellow-500'
    : 'bg-red-500';

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full ${color} inline-block`}
      title={`${meta.source} — ${meta.live ? 'Live' : 'Fallback'}${meta.cached ? ' (cached)' : ''}`}
    />
  );
}
