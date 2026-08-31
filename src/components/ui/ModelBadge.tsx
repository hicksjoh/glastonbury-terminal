'use client';

import React from 'react';
import { PillBadge } from './PillBadge';
import { color, font } from '@/lib/design-tokens';

// A pill that identifies which Claude model produced a piece of output,
// with optional latency + cost. Sits under briefings, agent traces,
// long-form Keisha replies. Matches the Claude.ai model chip vibe.

export interface ModelBadgeProps {
  model: string | null | undefined;
  latencyMs?: number | null;
  costUsd?: number | null;
  cached?: boolean;
}

function shortModelName(model: string | null | undefined): string {
  if (!model) return 'Claude';
  const m = model.toLowerCase();
  if (m.includes('opus-5'))    return 'Opus 5';
  if (m.includes('opus-4-8'))  return 'Opus 4.8';
  if (m.includes('opus-4-7'))  return 'Opus 4.7';
  if (m.includes('opus-4-6'))  return 'Opus 4.6';
  if (m.includes('opus'))      return 'Opus';
  if (m.includes('sonnet-5'))  return 'Sonnet 5';
  if (m.includes('sonnet-4-6')) return 'Sonnet 4.6';
  if (m.includes('sonnet'))    return 'Sonnet';
  if (m.includes('haiku-4-5')) return 'Haiku 4.5';
  if (m.includes('haiku'))     return 'Haiku';
  return model;
}

export function ModelBadge({ model, latencyMs, costUsd, cached }: ModelBadgeProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <PillBadge tone="gold" size="sm">
        <span style={{ fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
          {shortModelName(model)}
        </span>
      </PillBadge>
      {cached && (
        <span style={{ fontSize: 10, color: color.positive, fontFamily: font.mono }}>cached</span>
      )}
      {typeof latencyMs === 'number' && latencyMs > 0 && (
        <span style={{ fontSize: 10, color: color.textDim, fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
          {latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
        </span>
      )}
      {typeof costUsd === 'number' && costUsd > 0 && (
        <span style={{ fontSize: 10, color: color.textDim, fontFamily: font.mono, fontVariantNumeric: 'tabular-nums' }}>
          ${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}
        </span>
      )}
    </span>
  );
}
