/**
 * The wire contract between `/api/autopilot` and `/app/autopilot/page.tsx`.
 *
 * These two sides had drifted completely apart. The route emitted
 * `{ symbol, signalScore, crewConsensus, guardResult, kellySize, status }`
 * while the page declared and rendered
 * `{ score, crewVerdict, crewConfidence, guardPass, kellyShares, kellyDollars }`
 * — not one field name in common. The page called
 * `c.kellyDollars.toLocaleString()` unguarded, so the first candidate the
 * pipeline ever produced would throw `Cannot read properties of undefined`
 * straight into the error boundary. It only stayed quiet because `candidates`
 * had always come back empty.
 *
 * `executed` was worse: it carried three different shapes depending on which
 * handler answered — approved candidates from a scan, raw `autopilot_executions`
 * rows from status/history, and an ad-hoc `{ orderId, orderStatus }` object from
 * an execute. The page expected a fourth shape and read `ex.price.toFixed(2)`.
 *
 * One module, imported by both sides, so the compiler catches the next drift.
 */

export type CandidateStatus = 'approved' | 'rejected' | 'guard_blocked';

export interface AutopilotCandidate {
  symbol: string;
  /** Scanner confluence score, 0-100. */
  signalScore: number;
  /** Trading-crew verdict text, e.g. 'BUY' / 'HOLD' / 'REJECT'. */
  crewConsensus: string;
  guardResult: { passed: boolean; violations: string[] };
  /**
   * Kelly dollars at risk. Deliberately nullable: the sizer fails closed to
   * null on non-finite input, and JSON renders NaN as null anyway — so every
   * consumer must handle the null rather than formatting it blind.
   */
  kellySize: number | null;
  status: CandidateStatus;
  reason?: string;
}

export interface AutopilotExecution {
  id: string;
  symbol: string;
  /**
   * 'unknown' for anything that is not exactly buy or sell. This is an audit
   * surface: defaulting a corrupt or unrecognised side ('', 'BUY_TO_COVER', a
   * null column) to 'buy' would print a direction that never happened.
   */
  side: 'buy' | 'sell' | 'unknown';
  /** null when the row carries no usable quantity — not 0, which reads as a real zero-share fill. */
  shares: number | null;
  /** Average fill price. null while the order is accepted but unfilled. */
  price: number | null;
  orderId: string | null;
  orderStatus: string | null;
  pipelineId: string | null;
  /** ISO 8601, or null when the row has no timestamp. Never "now" as a stand-in. */
  executedAt: string | null;
}

export interface AutopilotResponse {
  pipelineId: string | null;
  stage: string;
  candidates: AutopilotCandidate[];
  /** Orders actually sent to the broker — never candidates. */
  executed: AutopilotExecution[];
  rejected: AutopilotCandidate[];
  timestamp: string;
}

function asFiniteOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce one `autopilot_executions` row into the wire shape. Supabase columns
 * are snake_case and every one of them is nullable, so nothing here is trusted
 * to exist.
 */
export function normalizeExecutionRow(row: Record<string, unknown>): AutopilotExecution {
  const rawSide = String(row.side ?? '').toLowerCase();
  const createdAt = row.created_at == null ? null : String(row.created_at);
  return {
    id: String(row.id ?? row.order_id ?? `${row.symbol ?? 'unknown'}-${row.created_at ?? ''}`),
    symbol: String(row.symbol ?? ''),
    side: rawSide === 'sell' ? 'sell' : rawSide === 'buy' ? 'buy' : 'unknown',
    shares: asFiniteOrNull(row.shares),
    price: asFiniteOrNull(row.filled_avg_price),
    orderId: row.order_id == null ? null : String(row.order_id),
    orderStatus: row.status == null ? null : String(row.status),
    pipelineId: row.pipeline_id == null ? null : String(row.pipeline_id),
    executedAt: createdAt,
  };
}
