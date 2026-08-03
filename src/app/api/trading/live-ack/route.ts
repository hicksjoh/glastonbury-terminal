/**
 * Live-trading acknowledgment endpoint.
 *
 * POST — mint a fresh token. Body: { phrase: "CONFIRM LIVE" }.
 *   Returns { token, expiresAt } on success, 428/403 on invalid phrase.
 * GET  — check whether a token in the `x-live-ack` header is still valid.
 *   Returns { valid: true, expiresAt } or { valid: false, code, message }.
 * DELETE — revoke a token. Body or header: { token }.
 *
 * All three paths are session-scoped; every request must survive the same
 * middleware auth the rest of the app uses. The route ONLY runs when
 * TRADING_MODE=live server-side — in paper mode it 400s to make the
 * mis-config obvious.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { getServerTradingMode, LiveOrderRejectedError } from '@/lib/trading-mode';
import { mintLiveAckToken, verifyLiveAckToken, revokeLiveAckToken, LIVE_ACK_PHRASE } from '@/lib/live-ack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ensureLiveMode(): NextResponse | null {
  if (getServerTradingMode() !== 'live') {
    return NextResponse.json(
      {
        error: 'live-ack endpoint is only usable when TRADING_MODE=live on the server',
        hint: 'Set TRADING_MODE=live and redeploy before minting live-ack tokens.',
      },
      { status: 400 },
    );
  }
  return null;
}

// ── POST: mint token ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const modeGuard = ensureLiveMode();
  if (modeGuard) return modeGuard;

  const { key } = await getRateLimitIdentity(req);
  // Tight limit — we don't need many ack mints per session
  const { allowed } = await checkRateLimitDurable('live-ack-mint', key, 5, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many ack attempts — slow down' }, { status: 429 });

  let phrase: string;
  try {
    const body = (await req.json()) as { phrase?: string };
    phrase = String(body.phrase ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await mintLiveAckToken({
      phrase,
      userHint: key,
    });
    return NextResponse.json({
      token: result.token,
      expiresAt: result.expiresAt,
      note: `Store this token in sessionStorage as "glastonbury.liveAck" and include it in every order POST as an "x-live-ack" header. Ack phrase: "${LIVE_ACK_PHRASE}".`,
    });
  } catch (err) {
    if (err instanceof LiveOrderRejectedError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status() });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── GET: verify current token ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const modeGuard = ensureLiveMode();
  if (modeGuard) return modeGuard;

  const token = req.headers.get('x-live-ack') ?? undefined;
  try {
    const row = await verifyLiveAckToken(token);
    return NextResponse.json({ valid: true, expiresAt: row.expires_at });
  } catch (err) {
    if (err instanceof LiveOrderRejectedError) {
      return NextResponse.json(
        { valid: false, code: err.code, message: err.message },
        { status: err.status() },
      );
    }
    return NextResponse.json({ valid: false, error: (err as Error).message }, { status: 500 });
  }
}

// ── DELETE: revoke token ───────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const token = req.headers.get('x-live-ack') ?? undefined;
  await revokeLiveAckToken(token);
  return NextResponse.json({ revoked: true });
}
