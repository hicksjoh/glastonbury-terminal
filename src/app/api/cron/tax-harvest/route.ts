import { NextRequest, NextResponse } from 'next/server';
import { runTaxHarvestScan, persistSuggestions } from '@/lib/tax-harvest-engine';
import { sendResendEmail } from '@/lib/resend-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('authorization') ?? '';
    const headerKey = req.headers.get('x-api-key') ?? '';
    const ok = header === `Bearer ${cronSecret}` || headerKey === cronSecret;
    // Allow manual auth'd runs through without secret
    const internalKey = req.headers.get('x-internal-key') ?? '';
    const expected = process.env.INTERNAL_API_KEY ?? '';
    const hasCookieAuth = !!req.cookies.get('gt-auth');
    if (!ok && !hasCookieAuth && !(expected && internalKey === expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

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
}

export const GET = handle;
export const POST = handle;
