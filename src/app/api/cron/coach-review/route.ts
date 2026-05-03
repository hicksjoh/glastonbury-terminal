import { NextRequest, NextResponse } from 'next/server';
import { runCoachReview, persistCoachReview } from '@/lib/coach-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HC_SLUG = 'cron-coach-review';

// Auth: this route is in middleware's PUBLIC_API_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes. Fails CLOSED when CRON_SECRET is unset.
async function handle(req: NextRequest): Promise<NextResponse> {
  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/coach-review',
    allowInternalKey: true,
  });
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await pingHealthcheck(HC_SLUG, 'start');

  try {
    const result = await runCoachReview();
    const { weekOf, id } = await persistCoachReview('wes', result);

    sendResendEmail({
      subject: `Weekly Coach Review — ${result.patterns_detected.length} pattern(s) flagged`,
      text: `Week of ${weekOf}\n\nTrade count: ${result.trade_count}\nP&L: $${result.pnl_usd.toFixed(2)}\n\nRule for next week:\n${result.primary_rule_for_next_week}\n\nPatterns:\n${result.patterns_detected.map(p => `- ${p.type} [${p.severity}]: ${p.evidence}`).join('\n')}\n\n${result.review_markdown.slice(0, 2000)}...\n\nFull review: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/journal/coach`,
    }).catch(() => {});

    await pingHealthcheck(HC_SLUG, 'success');

    return NextResponse.json({
      week_of: weekOf,
      id,
      trade_count: result.trade_count,
      patterns_detected: result.patterns_detected,
      primary_rule_for_next_week: result.primary_rule_for_next_week,
      model: result.model_used,
    });
  } catch (err) {
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
