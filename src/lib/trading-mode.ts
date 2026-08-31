/**
 * Trading-mode single source of truth.
 *
 * Prior to this module, "paper vs live" was enforced by
 * `assertPaperTrading()` in @/lib/alpaca — a hard block that refused any
 * broker URL other than paper-api.alpaca.markets. That guard existed
 * because the terminal was locked to paper trading by design.
 *
 * This module replaces that binary lock with a mode-aware assertion.
 * The mode is set explicitly via env — no drift from a mis-set base URL,
 * no accidental live submission from an unset env, no silent switch
 * when a route reads ALPACA_BASE_URL differently than another.
 *
 * Env contract:
 *   TRADING_MODE                      "paper" (default) | "live"
 *   NEXT_PUBLIC_TRADING_MODE          MUST match TRADING_MODE (client-visible banner)
 *   ALPACA_BASE_URL                   Must resolve to the host expected by the mode
 *
 * If ALPACA_BASE_URL disagrees with TRADING_MODE, assertTradingModeAllowed
 * throws — the two must move together. Ambiguity is the failure mode we
 * are protecting against.
 *
 * For live-trading safety, callers must ALSO pass through:
 *   - verifyLiveAckToken (session-scoped user acknowledgment, see live-ack.ts)
 *   - assertNotionalTypedConfirm (typed dollar amount for orders > threshold)
 */

export type TradingMode = 'paper' | 'live';

export const ALPACA_PAPER_HOST = 'paper-api.alpaca.markets';
export const ALPACA_LIVE_HOST  = 'api.alpaca.markets';

/**
 * Read TRADING_MODE server env. Defaults to 'paper' — a missing or
 * malformed value must NEVER resolve to live.
 */
export function getServerTradingMode(): TradingMode {
  const v = (process.env.TRADING_MODE ?? '').trim().toLowerCase();
  return v === 'live' ? 'live' : 'paper';
}

/**
 * Return the Alpaca host expected for a given mode. Callers use this
 * to construct URLs consistently (no more `process.env.ALPACA_BASE_URL
 * || 'https://paper-api…'` scattered across 12 files).
 */
export function expectedAlpacaHost(mode: TradingMode = getServerTradingMode()): string {
  return mode === 'live' ? ALPACA_LIVE_HOST : ALPACA_PAPER_HOST;
}

export function expectedAlpacaBaseUrl(mode: TradingMode = getServerTradingMode()): string {
  return `https://${expectedAlpacaHost(mode)}`;
}

/**
 * Hard-block any order-submission path if the broker URL doesn't match
 * the declared trading mode. Runs on EVERY /v2/orders POST.
 *
 * Throws when:
 *   - baseUrl is malformed
 *   - baseUrl host doesn't match the host expected for the current mode
 *
 * Does NOT throw when live mode is active AND the URL is the live host
 * — but callers MUST additionally verify the live-ack + notional-confirm
 * checks. This function only proves the mode/URL alignment; it does not
 * grant permission to submit real orders on its own.
 */
export function assertTradingModeAllowed(
  baseUrl: string,
  mode: TradingMode = getServerTradingMode(),
): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid ALPACA_BASE_URL: ${baseUrl}`);
  }

  // TLS is non-negotiable — the pre-fix guard compared only `.host`, so
  // `http://api.alpaca.markets` sailed through and would have shipped
  // broker credentials and order payloads in cleartext.
  if (url.protocol !== 'https:') {
    throw new Error(
      `Refusing to submit order: ALPACA_BASE_URL uses "${url.protocol}" — ` +
        `HTTPS is required for broker traffic.`,
    );
  }
  // Embedded credentials in the URL would leak into logs and Referer.
  if (url.username || url.password) {
    throw new Error('Refusing to submit order: ALPACA_BASE_URL must not embed credentials.');
  }
  // Non-default port on a broker host means someone is redirecting us.
  if (url.port && url.port !== '443') {
    throw new Error(`Refusing to submit order: unexpected port "${url.port}" on broker URL.`);
  }

  const expected = expectedAlpacaHost(mode);
  if (url.host !== expected) {
    throw new Error(
      `Refusing to submit order: ALPACA_BASE_URL host is "${url.host}", ` +
        `but TRADING_MODE is "${mode}" (expected "${expected}"). ` +
        `Align the two env vars — never rely on just one.`,
    );
  }
}

/**
 * Legacy shim so the old `assertPaperTrading()` call sites keep working
 * during migration. Delegates to assertTradingModeAllowed but pins the
 * mode to 'paper' — matches the old defense-in-depth semantics
 * exactly: this call will THROW if the current server mode is 'live',
 * which is what a caller labeled `assertPaperTrading` almost certainly
 * intended.
 *
 * @deprecated Use assertTradingModeAllowed(baseUrl) instead. Migrate
 *   callers that genuinely need paper-only enforcement (test harness)
 *   to `assertTradingModeAllowed(url, 'paper')` for clarity.
 */
export function assertPaperTradingLegacy(baseUrl: string): void {
  assertTradingModeAllowed(baseUrl, 'paper');
}

/**
 * Notional-confirm threshold. Orders whose (qty × estimatedPrice) meets
 * or exceeds this dollar amount in LIVE mode must include a `typedConfirm`
 * field matching the notional to the nearest dollar (e.g., "5000" for
 * a $5,000 order).
 */
export function liveTypedConfirmThresholdUsd(): number {
  const raw = Number(process.env.LIVE_TYPED_CONFIRM_THRESHOLD_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
}

/**
 * Enforce the typed-confirm check for large live orders.
 *
 * @param notionalUsd  qty × estimatedPrice (in USD)
 * @param typedConfirm the string the user typed to acknowledge — must
 *                     equal the notional rounded to the nearest dollar
 *                     (as a string with no thousands separator, no "$")
 *
 * Paper orders pass through untouched. Live orders below the threshold
 * also pass. Live orders at/above the threshold throw unless the typed
 * value matches.
 */
export function assertNotionalTypedConfirm(
  notionalUsd: number,
  typedConfirm: string | undefined,
  mode: TradingMode = getServerTradingMode(),
): void {
  if (mode !== 'live') return;
  const threshold = liveTypedConfirmThresholdUsd();

  // FAIL CLOSED on an indeterminate notional. The pre-fix code returned
  // early when !Number.isFinite(notionalUsd), which meant a market order
  // (no limit_price → notional NaN/0/Infinity) skipped this gate entirely
  // regardless of size. An unpriceable order is the LEAST safe kind to
  // wave through, so it now hard-rejects with actionable guidance.
  if (!Number.isFinite(notionalUsd)) {
    throw new LiveOrderRejectedError(
      'notional_indeterminate',
      'Cannot determine this order\'s dollar value, so the large-order ' +
        'confirmation gate cannot be applied. Submit it as a LIMIT order ' +
        'so the notional is known before it reaches the market.',
    );
  }

  // A negative notional is nonsense, and `notionalUsd < threshold` would
  // wave it through as "small" no matter how large the true exposure. The
  // only safe reading of a number we cannot explain is "block it".
  if (notionalUsd < 0) {
    throw new LiveOrderRejectedError(
      'notional_indeterminate',
      `Computed a negative order notional ($${notionalUsd}). Refusing to ` +
        'apply the large-order gate to a value that cannot be right.',
    );
  }

  if (notionalUsd < threshold) return;
  const expected = Math.round(notionalUsd).toString();
  if ((typedConfirm ?? '').trim() !== expected) {
    throw new LiveOrderRejectedError(
      'typed_confirm_required',
      `Order notional $${expected} ≥ $${threshold} in LIVE mode. ` +
        `Client must POST typedConfirm="${expected}" alongside the order.`,
      { notionalUsd: Math.round(notionalUsd), thresholdUsd: threshold },
    );
  }
}

/**
 * Structured error thrown by the live-trading safety layer. Distinct from
 * AlpacaError so callers can return 428 (Precondition Required) or 403
 * with a machine-readable code the client can use to prompt the user.
 */
export class LiveOrderRejectedError extends Error {
  readonly code:
    | 'trading_mode_paper'
    | 'live_ack_required'
    | 'live_ack_expired'
    | 'live_ack_invalid'
    | 'typed_confirm_required'
    | 'notional_indeterminate'
    | 'autopilot_live_disabled';
  /**
   * Extra fields echoed to the client so the confirm dialog can render the
   * exact dollar figure the SERVER computed — the client's own estimate can
   * differ (market orders, stale quotes) and typing a mismatched number
   * would loop forever.
   */
  readonly detail?: { notionalUsd?: number; thresholdUsd?: number };
  constructor(
    code: LiveOrderRejectedError['code'],
    message: string,
    detail?: LiveOrderRejectedError['detail'],
  ) {
    super(message);
    this.name = 'LiveOrderRejectedError';
    this.code = code;
    this.detail = detail;
  }
  /** HTTP status code to return to the client. */
  status(): number {
    switch (this.code) {
      case 'trading_mode_paper':      return 403;
      case 'live_ack_required':       return 428;
      case 'live_ack_expired':        return 428;
      case 'live_ack_invalid':        return 403;
      case 'typed_confirm_required':  return 428;
      case 'notional_indeterminate':  return 428;
      case 'autopilot_live_disabled': return 403;
    }
  }
}
