/**
 * Timezone-pinned clock helpers.
 *
 * The terminal is an ET-based product (US equity session, ET cron slots), and
 * it renders on a UTC server but hydrates in the user's browser. Any wall-clock
 * text derived from the ambient timezone therefore differs between server and
 * client and trips React hydration error #425.
 *
 * Everything here takes an explicit `timeZone`, so the output is identical no
 * matter which timezone the host runs in.
 */

export const APP_TIME_ZONE = 'America/New_York';

/** Hour of day (0-23) at `now`, in ET. */
function getEtHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .find((p) => p.type === 'hour')?.value;

  return Number.parseInt(hour ?? '0', 10) % 24;
}

/** Time-of-day greeting, bucketed on the ET hour. */
export function getGreeting(now: Date = new Date()): string {
  const hour = getEtHour(now);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The ET calendar date as plain numbers. `month` is 0-indexed to match the
 * `Date` API. Use this instead of `new Date().getMonth()` etc. anywhere the
 * value is rendered, so a UTC server and an ET browser agree on the day.
 */
export function getEtDateParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);

  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  return { year: num('year'), month: num('month') - 1, day: num('day') };
}

/** A `Date` pinned to midnight of the current ET calendar day. */
export function getEtToday(now: Date = new Date()): Date {
  const { year, month, day } = getEtDateParts(now);
  return new Date(year, month, day);
}

/** Stable per-day key (ET), e.g. "2026-8-30". */
export function getEtDayKey(now: Date = new Date()): string {
  const { year, month, day } = getEtDateParts(now);
  return `${year}-${month + 1}-${day}`;
}

/** Long-form ET calendar date, e.g. "Sunday, August 30, 2026". */
export function getLongDateLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);
}
