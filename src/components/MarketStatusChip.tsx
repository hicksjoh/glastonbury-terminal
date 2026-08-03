'use client';

import { useEffect, useState } from 'react';
import { color, font, radius, size as sz, weight } from '@/lib/design-tokens';

// MARKET OPEN status chip — the terminal's single ambient heartbeat.
// US equity session phases computed client-side in America/New_York,
// re-checked every 60s. The dot pulses (`.market-pulse-dot`, globals.css)
// only while the regular session is open; every other phase is static.

type MarketPhase = 'open' | 'pre' | 'after' | 'closed';

const PHASE_LABEL: Record<MarketPhase, string> = {
  open:   'Market Open',
  pre:    'Pre-Market',
  after:  'After Hours',
  closed: 'Market Closed',
};

/** US equity session in America/New_York: Mon–Fri, pre 4:00–9:30,
 *  regular 9:30–16:00, after 16:00–20:00. Holidays not modeled. */
export function getMarketPhase(now: Date = new Date()): MarketPhase {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? '';

  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';

  const mins = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'open';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'after';
  return 'closed';
}

export function MarketStatusChip() {
  // null until mounted — avoids a server/client hydration mismatch on a
  // time-dependent render.
  const [phase, setPhase] = useState<MarketPhase | null>(null);

  useEffect(() => {
    const update = () => setPhase(getMarketPhase());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!phase) return null;

  const isOpen = phase === 'open';

  return (
    <div
      role="status"
      aria-label={`US equity market status: ${PHASE_LABEL[phase]}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span
        className={isOpen ? 'market-pulse-dot' : undefined}
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: radius.full,
          background: isOpen ? color.gold : color.textDim,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: sz.micro.fontSize,
          lineHeight: `${sz.micro.lineHeight}px`,
          fontWeight: weight.medium,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: color.textMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {PHASE_LABEL[phase]}
      </span>
    </div>
  );
}
