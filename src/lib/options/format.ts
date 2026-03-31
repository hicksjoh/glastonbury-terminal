/**
 * Safe numeric formatting utilities for options data.
 * Alpaca's API returns many numeric fields as strings — these helpers
 * prevent "toFixed is not a function" crashes in rendering code.
 */

/** Safely format a value to N decimal places. Returns '—' for zero/NaN. */
export function formatNum(value: unknown, decimals = 2): string {
  const num = Number(value);
  if (isNaN(num) || num === 0) return '—';
  return num.toFixed(decimals);
}

/** Like formatNum but returns the number itself (for intermediate math). */
export function toNum(value: unknown): number {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

/** Format volume/OI with K suffix for 1000+. Returns '—' for zero. */
export function formatVol(value: unknown): string {
  const n = Number(value);
  if (isNaN(n) || n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
