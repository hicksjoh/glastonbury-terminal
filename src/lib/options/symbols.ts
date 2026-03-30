// OCC Option Symbol Parser & Builder
import type { ParsedOCCSymbol } from './types';

/**
 * Parse an OCC option symbol into components
 * Format: AAPL260418C00190000
 *         ^^^^------^--------
 *         |   |     |  |
 *         |   |     |  Strike × 1000 (8 digits, right-padded with zeros)
 *         |   |     C=Call, P=Put
 *         |   YYMMDD expiration
 *         Underlying (1-6 chars)
 */
export function parseOCCSymbol(occ: string): ParsedOCCSymbol | null {
  // OCC symbols: underlying (variable length) + 6-digit date + C/P + 8-digit strike
  // Total suffix is always 15 chars: YYMMDD + C/P + 8 digits
  if (occ.length < 16) return null;

  const suffix = occ.slice(-15);
  const underlying = occ.slice(0, -15);

  if (!underlying || underlying.length > 6) return null;

  const dateStr = suffix.slice(0, 6);
  const typeChar = suffix.charAt(6);
  const strikeStr = suffix.slice(7);

  if (typeChar !== 'C' && typeChar !== 'P') return null;

  const yy = parseInt(dateStr.slice(0, 2));
  const mm = parseInt(dateStr.slice(2, 4));
  const dd = parseInt(dateStr.slice(4, 6));

  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null;

  const year = 2000 + yy;
  const expiry = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const strike = parseInt(strikeStr) / 1000;
  if (isNaN(strike)) return null;

  return {
    underlying,
    expiry,
    type: typeChar === 'C' ? 'call' : 'put',
    strike,
  };
}

/**
 * Build an OCC option symbol from components
 */
export function buildOCCSymbol(
  underlying: string,
  expiry: string, // YYYY-MM-DD
  type: 'call' | 'put',
  strike: number
): string {
  const [year, month, day] = expiry.split('-');
  const yy = year.slice(2);
  const typeChar = type === 'call' ? 'C' : 'P';
  const strikeInt = Math.round(strike * 1000);
  const strikePadded = String(strikeInt).padStart(8, '0');

  return `${underlying.toUpperCase()}${yy}${month}${day}${typeChar}${strikePadded}`;
}

/**
 * Format option for human-readable display
 * "AAPL Apr 18 $190 Call"
 */
export function formatOptionDisplay(occ: string): string {
  const parsed = parseOCCSymbol(occ);
  if (!parsed) return occ;

  return formatOptionParts(parsed.underlying, parsed.expiry, parsed.strike, parsed.type);
}

export function formatOptionParts(
  underlying: string,
  expiry: string,
  strike: number,
  type: 'call' | 'put'
): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(expiry + 'T12:00:00'); // Noon to avoid timezone issues
  const month = months[date.getMonth()];
  const day = date.getDate();
  const typeLabel = type === 'call' ? 'Call' : 'Put';
  const strikeStr = strike % 1 === 0 ? `$${strike}` : `$${strike.toFixed(2)}`;

  return `${underlying} ${month} ${day} ${strikeStr} ${typeLabel}`;
}

/**
 * Calculate days to expiration
 */
export function daysToExpiration(expiry: string): number {
  const exp = new Date(expiry + 'T16:00:00'); // Market close
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Find the next monthly expiration (3rd Friday)
 */
export function nextMonthlyExpiration(fromDate?: Date): string {
  const d = fromDate ? new Date(fromDate) : new Date();

  // Move to next month if we're past this month's expiration
  let year = d.getFullYear();
  let month = d.getMonth();

  for (let attempt = 0; attempt < 3; attempt++) {
    const thirdFriday = getThirdFriday(year, month);
    if (thirdFriday > d) {
      return thirdFriday.toISOString().split('T')[0];
    }
    month++;
    if (month > 11) { month = 0; year++; }
  }

  // Fallback
  month++;
  if (month > 11) { month = 0; year++; }
  return getThirdFriday(year, month).toISOString().split('T')[0];
}

function getThirdFriday(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay();
  // Days until first Friday
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const firstFriday = 1 + daysUntilFriday;
  const thirdFriday = firstFriday + 14;
  return new Date(year, month, thirdFriday);
}

/**
 * Find next N weekly expirations (Fridays)
 */
export function nextWeeklyExpirations(count = 8): string[] {
  const dates: string[] = [];
  const d = new Date();
  // Start from next Friday
  const day = d.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFriday);

  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 7);
  }

  return dates;
}

/**
 * Short format for compact display: "Apr 18 $190C"
 */
export function formatOptionShort(
  expiry: string,
  strike: number,
  type: 'call' | 'put'
): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(expiry + 'T12:00:00');
  const month = months[date.getMonth()];
  const day = date.getDate();
  const t = type === 'call' ? 'C' : 'P';
  const s = strike % 1 === 0 ? `$${strike}` : `$${strike.toFixed(2)}`;

  return `${month} ${day} ${s}${t}`;
}
