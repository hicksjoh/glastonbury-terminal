import { NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

export async function GET() {
  const { allowed } = rateLimit('keisha-briefing', 5, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const baseUrl = getBaseUrl();
    const supabase = createServiceClient();

    // Fetch all intelligence sources in parallel
    const [portfolio, gex, macro, scanner, insider, earnings, pairs, drift] = await Promise.all([
      fetch(`${baseUrl}/api/portfolio`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/gex?symbol=SPY`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/macro`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/scanner?preset=confluence`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/insider?type=insider&days=1`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/earnings?range=this_week`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/pairs?symbols=AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${baseUrl}/api/drift?watchlist=true`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Fetch Keisha's track record (last 7 days)
    let recentRecs = null;
    try {
      const { data } = await (supabase as any).from('keisha_recommendations')
        .select('*')
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
      recentRecs = data;
    } catch { /* table may not exist yet */ }

    // Fetch latest Monte Carlo VaR
    let mcResults = null;
    try {
      const { data } = await (supabase as any).from('monte_carlo_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      mcResults = data?.[0] || null;
    } catch { /* table may not exist yet */ }

    const context = JSON.stringify({
      portfolio,
      gex,
      macro,
      scanner: scanner?.signals?.slice(0, 5),
      insider: insider?.signals?.slice(0, 3),
      earnings: earnings?.upcoming?.slice(0, 5),
      pairs: pairs?.pairs?.filter((p: { zScore: number }) => Math.abs(p.zScore) > 1.5),
      drift,
      calendar: macro?.upcomingEvents,
      var: mcResults,
      recentRecs,
    });

    const briefingPrompt = `Generate a concise morning briefing for Wes, principal of The Glastonbury Group hedge fund terminal.

DATA PACKAGE:
${context}

BRIEFING FORMAT:
1. Open with the SINGLE most important thing Wes needs to know today (bold it)
2. Portfolio Status: overnight P&L, total value, any positions moving >3%
3. Market Structure: GEX regime (positive/negative), key levels, what it means for today
4. Macro Regime: current state, any shifts, Fed expectations
5. Top 3 Opportunities: from scanner + insider + pairs signals, each with 1-sentence thesis
6. Risk Radar: VaR status, any stress test warnings, concentrated positions
7. Earnings Watch: any portfolio holdings or watchlist names reporting
8. Action Items: your top 3 specific recommendations for today

TONE: Confident, direct, data-driven. Like a head strategist briefing the CIO at 6 AM.
No fluff. Every sentence must be actionable or informative.
End with one motivational line — you're Keisha, Wes's AI edge.`;

    const portfolioContext = `BRIEFING DATA:\n${context}`;
    const response = await generateAnalysis(briefingPrompt, portfolioContext, [
      { role: 'user', content: briefingPrompt },
    ]);

    return NextResponse.json({
      briefing: response,
      timestamp: new Date().toISOString(),
      dataSourcesUsed: {
        portfolio: !!portfolio,
        gex: !!gex,
        macro: !!macro,
        scanner: !!scanner,
        insider: !!insider,
        earnings: !!earnings,
        pairs: !!pairs,
        drift: !!drift,
        var: !!mcResults,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/keisha/briefing] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
