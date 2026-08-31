/**
 * Non-finite value guards.
 *
 * Why this module exists
 * ----------------------
 * Every relational comparison against NaN is false. That means a guard
 * chain written as
 *
 *     if (x <= 0)        ...
 *     else if (x < 0.05) ...
 *     else               ...   // <-- NaN lands HERE
 *
 * routes garbage input to whatever the final `else` says. In this
 * codebase that final branch was "Strong edge detected", handed to the
 * autopilot. `Math.max(0, NaN)` is also `NaN`, so flooring does not
 * rescue it either.
 *
 * The rule: validate finiteness at the TOP of any function that turns
 * upstream data into a number a human or an order router will act on,
 * and fail closed. Never let a non-finite value reach a comparison
 * chain, a `.toFixed()`, or a JSON response.
 */

/** True only for a real, finite JS number (rejects NaN, ±Infinity, non-numbers). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when every supplied value is a finite number. */
export function allFinite(...values: unknown[]): boolean {
  return values.every(isFiniteNumber);
}

/** Coerce to a finite number, falling back when the input is not one. */
export function finiteOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/**
 * Recursively assert that a payload contains no NaN or ±Infinity before
 * it is serialized. `JSON.stringify` turns both into `null`, so a
 * contractually-numeric field silently becomes null on the wire and the
 * dashboard renders an empty or "NaN" cell. Use this at API boundaries.
 *
 * Returns the dotted paths of every offending field (empty = clean).
 */
export function findNonFiniteNumbers(payload: unknown, path = '$'): string[] {
  if (typeof payload === 'number') {
    return Number.isFinite(payload) ? [] : [path];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((v, i) => findNonFiniteNumbers(v, `${path}[${i}]`));
  }
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).flatMap(([k, v]) =>
      findNonFiniteNumbers(v, `${path}.${k}`),
    );
  }
  return [];
}
