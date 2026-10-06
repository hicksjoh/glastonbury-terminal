/**
 * What the order ticket should do with the server's answer.
 *
 * The ticket used to show a green "Order submitted" for every outcome except
 * two live-safety codes: a 403/422/500, or a fetch that threw, fell through to
 * the success screen ("still show submitted state for paper demo"). A rejected
 * order looked filled (QA 2026-10-05, blocker 1).
 */
export type OrderSubmitOutcome =
  | { kind: 'submitted' }
  | { kind: 'typed_confirm'; notionalUsd: number | null }
  | { kind: 'ack_expired' }
  | { kind: 'rejected'; message: string };

const ACK_CODES = new Set(['live_ack_required', 'live_ack_expired', 'live_ack_invalid']);

export function classifyOrderResponse(
  ok: boolean,
  status: number,
  body: unknown,
): OrderSubmitOutcome {
  if (ok) return { kind: 'submitted' };

  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code : '';

  if (code === 'typed_confirm_required') {
    const n = Number(b.notional_usd);
    return { kind: 'typed_confirm', notionalUsd: Number.isFinite(n) ? n : null };
  }
  if (ACK_CODES.has(code)) return { kind: 'ack_expired' };

  const detail =
    (typeof b.error === 'string' && b.error) ||
    (typeof b.message === 'string' && b.message) ||
    '';
  return {
    kind: 'rejected',
    message: detail ? `Order rejected (${status}): ${detail}` : `Order rejected (${status}).`,
  };
}
