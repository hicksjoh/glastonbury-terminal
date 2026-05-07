import { NextRequest, NextResponse } from 'next/server';
import { getAccount } from '@/lib/alpaca';
import { getQuote } from '@/lib/fmp-client';
import { createServiceClient } from '@/lib/supabase';
import { sendPushNotification, type PushSubscriptionData } from '@/lib/web-push';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';
import { tryClaimCronRun, markCronRunComplete, todayKeyET } from '@/lib/cron-idempotency';

// F10 — Lightweight 6:30 AM push notification.
//
// Fires at 6:30 AM EDT (10:30 UTC) before the market opens. Skips Claude
// entirely so delivery is sub-second reliable. Payload: net equity,
// overnight P&L vs prior close, VIX. The deeper Claude-powered briefing
// runs 3 hours later via /api/briefing/scheduled.
//
// Authentication: Vercel cron dispatches GET with `Authorization: Bearer <CRON_SECRET>`.
// POST is accepted for manual invocation.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HC_SLUG = 'briefing-morning-push';
const JOB_NAME = 'briefing-morning-push';

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatSigned(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${formatCurrency(n)}`;
}

async function buildMorningPushPayload(): Promise<{
  title: string;
  body: string;
  icon: string;
  url: string;
  data: Record<string, unknown>;
}> {
  const [account, vix] = await Promise.all([
    getAccount().catch(() => null),
    getQuote('^VIX').catch(() => null),
  ]);

  const equity = account ? parseFloat(account.equity) : 0;
  const lastEquity = account ? parseFloat(account.last_equity) : equity;
  const dayPL = equity - lastEquity;
  const dayPct = lastEquity > 0 ? (dayPL / lastEquity) * 100 : 0;
  const vixText = vix?.price != null ? `VIX ${vix.price.toFixed(1)}` : 'VIX —';

  const title = '🌅 Morning snapshot';
  const body = [
    formatCurrency(equity),
    `overnight ${formatSigned(dayPL)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)`,
    vixText,
  ].join(' · ');

  return {
    title,
    body,
    icon: '/icons/icon-192x192.png',
    url: '/',
    data: { equity, dayPL, dayPct, vix: vix?.price ?? null, source: 'morning-push' },
  };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!(await cronIsAuthorized(req, { routeName: 'briefing-morning-push' }))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Idempotency: one morning push per ET-day. A Vercel retry of a transient
  // failure must not buzz every device twice.
  const runKey = todayKeyET();
  const claimed = await tryClaimCronRun(JOB_NAME, runKey);
  if (!claimed) {
    return NextResponse.json({ ok: true, skipped: 'already_ran_today', runKey });
  }

  await pingHealthcheck(HC_SLUG, 'start');

  try {
    const payload = await buildMorningPushPayload();
    const supabase = createServiceClient();

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth');

    if (subsErr) {
      console.error('[morning-push] subs query failed:', subsErr.message);
      await pingHealthcheck(HC_SLUG, 'fail');
      return NextResponse.json({ error: 'Subscription query failed' }, { status: 500 });
    }

    let sent = 0;
    let pruned = 0;

    if (subs && subs.length > 0) {
      await Promise.all(
        subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
          const subscription: PushSubscriptionData = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          };
          const ok = await sendPushNotification(subscription, payload);
          if (ok) {
            sent++;
          } else {
            // 410/404 responses fall through here — subscription is dead, clean it up.
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            pruned++;
          }
        }),
      );
    }

    await pingHealthcheck(HC_SLUG, 'success');
    await markCronRunComplete(JOB_NAME, runKey, { sent, pruned });

    return NextResponse.json({
      ok: true,
      subscribers: subs?.length ?? 0,
      sent,
      pruned,
      runKey,
      payload: { title: payload.title, body: payload.body, data: payload.data },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[morning-push] failed:', msg);
    // Don't mark complete on failure — let stale-window retry handle it.
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
