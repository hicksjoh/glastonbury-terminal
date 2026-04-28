import { NextRequest, NextResponse } from 'next/server';
import { loadWealthSnapshot } from '@/lib/hedge/rsu-analyzer';
import { fetchTradeIndicators } from '@/lib/alt-data/fred-trade';
import { fetchLatestSnapshots } from '@/lib/prediction-markets';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { createServiceClient } from '@/lib/supabase';

// F13 — Weekly Sunday 7 PM ET auto-email report.
//
// Vercel cron at "0 23 * * 0" (Sunday 23:00 UTC = Sunday 7 PM EDT during
// daylight time). Bundles wealth snapshot + trade indicators + prediction
// markets + recent storm alerts into one email so Wes opens Monday already
// oriented.
//
// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` and we
// also accept x-api-key + a `mode=dry-run` query param for safe local
// testing without burning a Resend send.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HC_SLUG = 'weekly-report';

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true;
  if (req.headers.get('x-api-key') === cronSecret) return true;
  return false;
}

function fmtUSD(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtSigned(n: number, suffix = ''): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}${suffix}`;
}

interface PriorWealth {
  rsu: number;
  brokerage: number;
  cash: number;
  realEstate: number;
  franchise: number;
  total: number;
  capturedAt: string;
}

async function loadPriorWealth(): Promise<PriorWealth | null> {
  try {
    const supabase = createServiceClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('weekly_report_snapshots')
      .select('payload, captured_at')
      .lt('captured_at', sevenDaysAgo)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { payload: PriorWealth; captured_at: string } | null;
    if (row?.payload) return { ...row.payload, capturedAt: row.captured_at };
  } catch { /* table may not exist yet */ }
  return null;
}

async function persistSnapshot(wealth: Awaited<ReturnType<typeof loadWealthSnapshot>>): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from('weekly_report_snapshots')
      .insert({ payload: wealth, captured_at: new Date().toISOString() });
  } catch { /* table may not exist yet — non-fatal */ }
}

async function buildReport(): Promise<{ subject: string; text: string; html: string }> {
  const [wealth, trade, predictions, prior] = await Promise.all([
    loadWealthSnapshot(),
    fetchTradeIndicators(4).catch(() => []),
    fetchLatestSnapshots().catch(() => []),
    loadPriorWealth(),
  ]);

  const nwDelta = prior ? wealth.total - prior.total : null;
  const nwPct = prior && prior.total > 0 ? ((wealth.total - prior.total) / prior.total) * 100 : null;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const subject = `🌙 Sunday Briefing — ${today}${nwDelta !== null ? ` · NW ${fmtSigned(nwDelta / 1000)}K` : ''}`;

  const lines: string[] = [];
  lines.push(`Sunday Briefing — ${today}`);
  lines.push('');
  lines.push(`💼 NET WORTH SNAPSHOT`);
  lines.push(`  Total: ${fmtUSD(wealth.total)}`);
  if (nwDelta !== null && nwPct !== null) {
    lines.push(`  vs last Sunday: ${fmtSigned(nwDelta / 1000, 'K')} (${fmtSigned(nwPct, '%')})`);
  }
  lines.push(`  RSU Anthropic: ${fmtUSD(wealth.rsu)} (${((wealth.rsu / wealth.total) * 100).toFixed(1)}% of NW)`);
  lines.push(`  CR3 Franchise: ${fmtUSD(wealth.franchise)}`);
  lines.push(`  Real Estate:   ${fmtUSD(wealth.realEstate)}`);
  lines.push(`  Cash:          ${fmtUSD(wealth.cash)}`);
  lines.push('');

  if (trade.length > 0) {
    lines.push(`📦 TRADE & SHIPPING PULSE`);
    for (const s of trade.slice(0, 6)) {
      const pct = s.changePct !== null ? fmtSigned(s.changePct, '%') : 'flat';
      lines.push(`  ${s.label}: ${pct}`);
    }
    lines.push('');
  }

  if (predictions.length > 0) {
    lines.push(`🎲 PREDICTION MARKETS — biggest moves this week`);
    const movers = predictions
      .filter(p => p.delta_24h !== null && Math.abs(p.delta_24h) > 0.02)
      .sort((a, b) => Math.abs((b.delta_24h ?? 0)) - Math.abs((a.delta_24h ?? 0)))
      .slice(0, 5);
    for (const p of movers) {
      const yes = p.yes_price !== null ? `${(p.yes_price * 100).toFixed(0)}%` : '?';
      const delta = p.delta_24h !== null ? fmtSigned(p.delta_24h * 100, 'pp') : '';
      lines.push(`  ${p.market_name}: ${yes} (${delta})`);
    }
    lines.push('');
  }

  lines.push(`📊 ON DECK NEXT WEEK`);
  lines.push(`  Check /api/fed-sentiment for any new FOMC speeches scored.`);
  lines.push(`  Check /api/whales?slug=berkshire&diff=true for fresh 13F deltas.`);
  lines.push(`  Check /api/hedge/rsu (POST) for an updated hedge debate.`);
  lines.push('');
  lines.push('— Glastonbury Terminal · cc.johnwesleyhicks.com');

  const text = lines.join('\n');

  // Lightweight HTML wrapper — Resend renders text/* as plain so HTML is
  // an upgrade for the inbox preview but not required for delivery.
  const html = `<pre style="font-family: ui-monospace, monospace; line-height: 1.55; color: #e8e8e8; background: #08080d; padding: 24px;">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;

  // Persist this Sunday's snapshot for next week's diff.
  await persistSnapshot(wealth);

  return { subject, text, html };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('mode') === 'dry-run';
  await pingHealthcheck(HC_SLUG, 'start');

  try {
    const report = await buildReport();

    if (dryRun) {
      await pingHealthcheck(HC_SLUG, 'success');
      return NextResponse.json({
        ok: true,
        dryRun: true,
        subject: report.subject,
        textPreview: report.text.slice(0, 600),
      });
    }

    const sendResult = await sendResendEmail({
      subject: report.subject,
      text: report.text,
      html: report.html,
    });

    if (!sendResult.ok) {
      await pingHealthcheck(HC_SLUG, 'fail');
      return NextResponse.json(
        { ok: false, error: sendResult.error ?? 'send failed' },
        { status: 502 },
      );
    }

    await pingHealthcheck(HC_SLUG, 'success');
    return NextResponse.json({
      ok: true,
      sentId: sendResult.id,
      subject: report.subject,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
