import { NextRequest, NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { sendResendEmail } from '@/lib/resend-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('authorization') ?? '';
    const headerKey = req.headers.get('x-api-key') ?? '';
    const ok = header === `Bearer ${cronSecret}` || headerKey === cronSecret;
    const hasCookieAuth = !!req.cookies.get('gt-auth');
    const internalKey = req.headers.get('x-internal-key') ?? '';
    const expected = process.env.INTERNAL_API_KEY ?? '';
    if (!ok && !hasCookieAuth && !(expected && internalKey === expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);

    sendResendEmail({
      subject: `Weekly Coach Review — ${result.patterns_detected.length} pattern(s) flagged`,
      text: `Week of ${weekOf}\n\nTrade count: ${result.trade_count}\nP&L: $${result.pnl_usd.toFixed(2)}\n\nRule for next week:\n${result.primary_rule_for_next_week}\n\nPatterns:\n${result.patterns_detected.map(p => `- ${p.type} [${p.severity}]: ${p.evidence}`).join('\n')}\n\n${result.review_markdown.slice(0, 2000)}...\n\nFull review: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/journal/coach`,
    }).catch(() => {});

    return NextResponse.json({
      week_of: weekOf,
      id,
      trade_count: result.trade_count,
      patterns_detected: result.patterns_detected,
      primary_rule_for_next_week: result.primary_rule_for_next_week,
      model: result.model_used,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
