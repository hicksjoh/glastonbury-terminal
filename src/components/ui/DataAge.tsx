import React from 'react';
import { color, font, radius, size as sz, space } from '@/lib/design-tokens';

export interface DataAgeProps {
  ts: string | number | null | undefined;
  warnAfterMs?: number;
  staleAfterMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function DataAge({
  ts,
  warnAfterMs = 6 * HOUR_MS,
  staleAfterMs = DAY_MS,
}: DataAgeProps) {
  if (ts === null || ts === undefined || ts === '') return null;

  const date = new Date(ts);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const ageMs = Math.max(0, Date.now() - time);
  let label: string;
  if (ageMs < 60_000) {
    label = 'just now';
  } else if (ageMs < HOUR_MS) {
    label = `${Math.floor(ageMs / 60_000)}m ago`;
  } else if (ageMs < DAY_MS) {
    label = `${Math.floor(ageMs / HOUR_MS)}h ago`;
  } else {
    label = date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const isStale = ageMs > staleAfterMs;
  const isWarning = !isStale && ageMs > warnAfterMs;
  const foreground = isStale ? color.negative : isWarning ? color.warning : color.textDim;
  const background = isStale ? color.negativeSubtle : isWarning ? color.warningSubtle : color.glassMd;

  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `${space[0.5]}px ${space[2]}px`,
        borderRadius: radius.chip,
        background,
        color: foreground,
        fontFamily: font.mono,
        fontSize: sz.micro.fontSize,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: `${sz.micro.lineHeight}px`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </time>
  );
}

export default DataAge;
