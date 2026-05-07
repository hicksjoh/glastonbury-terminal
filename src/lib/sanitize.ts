export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip HTML tags
    .trim()
    .slice(0, 10000); // Max length
}

/**
 * Loose sanitizer — keeps `^VIX`, `BRK/A`, `BRK-B`-style variants used by
 * different data providers. DO NOT use for direct URL interpolation; use
 * validateEquitySymbol + encodeURIComponent at every upstream call site.
 */
export function sanitizeSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9.^/-]/g, '').toUpperCase().slice(0, 10);
}

/**
 * Strict equity symbol validator (Codex audit finding p6-5).
 *
 * Returns the canonical UPPERCASE symbol if it matches a real equity
 * symbol shape: 1-5 alpha chars, optional dotted class suffix (e.g. AAPL,
 * MSFT, BRK.B, BF.A). Returns null otherwise.
 *
 * Rejected (vs the looser sanitizeSymbol):
 *   - Forward slash: BRK/A would be interpreted as a path segment
 *     attack on FMP/Alpaca URLs
 *   - Hyphen: BRK-B is sometimes seen but isn't an actual SEC ticker;
 *     the SEC spec uses dot-class. Force normalization.
 *   - Caret prefix (e.g. ^VIX): index symbol, NOT a tradable equity. Use
 *     a separate validator if/when we expose index-symbol routes.
 *   - Anything containing `/`, `?`, `#`, whitespace, control chars
 *
 * Equity-symbol routes MUST use this; the regex output is URL-safe by
 * construction so encodeURIComponent at upstream call sites is optional.
 */
const EQUITY_SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export function validateEquitySymbol(symbol: string | null | undefined): string | null {
  if (typeof symbol !== 'string') return null;
  const upper = symbol.trim().toUpperCase();
  if (upper.length === 0 || upper.length > 7) return null;
  if (!EQUITY_SYMBOL_RE.test(upper)) return null;
  return upper;
}
