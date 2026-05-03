import { NextRequest, NextResponse } from 'next/server';
import { runTaxHarvestScan, persistSuggestions } from '@/lib/tax-harvest-engine';
import { sendResendEmail } from '@/lib/resend-client';
import { pingHealthcheck } from '@/lib/healthchecks';
import { cronIsAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HC_SLUG = 'cron-tax-harvest';

// Auth: this route is in middleware's PUBLIC_API_ROUTES, so it must
// self-authenticate. See src/lib/cron-auth.ts for the full doc on
// accepted auth modes (Bearer/x-api-key CRON_SECRET, x-internal-key
// INTERNAL_API_KEY, signed gt-auth JWT). Fails CLOSED when CRON_SECRET
// is unset (Codex round-2 finding).
async function handle(req: NextRequest): Promise<NextResponse> {
  const ok = await cronIsAuthorized(req, {
    routeName: '/api/cron/tax-harvest',
    allowInternalKey: true,
  });
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await pingHealthcheck(HC_SLUG, 'start');

  try {
    const suggestions = await runTaxHarvestScan();
    const { inserted, week_of } = await persistSuggestions('wes', suggestions);

    if (inserted > 0) {
      const totalSavings = suggestions.reduce((s, x) => s + x.estimated_tax_savings_usd, 0);
      const totalLoss = suggestions.reduce((s, x) => s + Math.abs(x.unrealized_loss), 0);
      sendResendEmail({
        subject: `Tax-Loss Harvest — ${suggestions.length} candidates, $${totalSavings.toFixed(0)} potential savings`,
        text: `Week of ${week_of}:\n\nTotal unrealized loss scanned: $${totalLoss.toFixed(0)}\nTotal estimated federal tax savings: $${totalSavings.toFixed(0)}\n\n${suggestions.map(s => `• ${s.position_ticker} (loss $${Math.abs(s.unrealized_loss).toFixed(0)}) → ${s.swap_candidate_ticker ?? 'no swap found'}${s.swap_correlation ? ` (corr ${s.swap_correlation.toFixed(3)})` : ''}${s.wash_sale_safe ? ' · wash-safe' : ' · WASH RISK'}`).join('\n')}\n\nReview & queue: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/tax/harvest/weekly`,
      }).catch(() => {});
    }

    await pingHealthcheck(HC_SLUG, 'success');

    return NextResponse.json({
      week_of,
      suggestions_found: suggestions.length,
      inserted,
      summary: suggestions.map(s => ({
        ticker: s.position_ticker,
        loss: s.unrealized_loss,
        swap: s.swap_candidate_ticker,
        correlation: s.swap_correlation,
        wash_sale_safe: s.wash_sale_safe,
        estimated_tax_savings_usd: s.estimated_tax_savings_usd,
      })),
    });
  } catch (err) {
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
