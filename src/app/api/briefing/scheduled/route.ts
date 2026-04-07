import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { getAccount, getPositions } from '@/lib/alpaca';
import {
  buildMarketContext,
  getMarketGainers,
  getMarketLosers,
  getEarningsCalendar,
} from '@/lib/market-intel';
import { sendPushNotification } from '@/lib/web-push';
import type { PushSubscriptionData } from '@/lib/web-push';

// ─── Auth check ───────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  // Accept "Bearer <token>" or raw token in x-api-key header
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (req.headers.get('x-api-key') === cronSecret) return true;
  return false;
}

// ─── Gather all portfolio + market data ───────────────────
async function gatherPortfolioData() {
  const [account, positions] = await Promise.all([
    getAccount().catch(() => null),
    getPositions().catch(() => []),
  ]);

  const positionsArray = Array.isArray(positions) ? positions : [];
  const positionData = positionsArray.map((p: Record<string, string>) => ({
    symbol: p.symbol,
    qty: parseFloat(p.qty),
    market_value: parseFloat(p.market_value),
    cost_basis: parseFloat(p.cost_basis),
    unrealized_pl: parseFloat(p.unrealized_pl),
    unrealized_plpc: parseFloat(p.unrealized_plpc),
    current_price: parseFloat(p.current_price),
    change_today: parseFloat(p.change_today),
  }));

  return {
    equity: account ? parseFloat(account.equity) : 0,
    cash: account ? parseFloat(account.cash) : 0,
    buying_power: account ? parseFloat(account.buying_power) : 0,
    last_equity: account ? parseFloat(account.last_equity) : 0,
    day_pl: account ? parseFloat(account.equity) - parseFloat(account.last_equity) : 0,
    positions: positionData,
    total_market_value: positionData.reduce((s, p) => s + p.market_value, 0),
    total_unrealized_pl: positionData.reduce((s, p) => s + p.unrealized_pl, 0),
  };
}

async function gatherMarketData(portfolioSymbols: string[]) {
  const [gainers, losers, earnings, marketContext] = await Promise.all([
    getMarketGainers().catch(() => []),
    getMarketLosers().catch(() => []),
    getEarningsCalendar().catch(() => []),
    buildMarketContext(portfolioSymbols).catch(() => ''),
  ]);

  // Fetch VIX quote from FMP
  let vix: number | null = null;
  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (fmpKey) {
      const res = await fetch(
        `https://financialmodelingprep.com/stable/quote?symbol=^VIX&apikey=${fmpKey}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) vix = data[0].price;
      }
    }
  } catch { /* VIX optional */ }

  // Fetch sector performance from FMP
  let sectors: { sector: string; changesPercentage: number }[] = [];
  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (fmpKey) {
      const res = await fetch(
        `https://financialmodelingprep.com/stable/sector-performance?apikey=${fmpKey}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          sectors = data.map((s: { sector: string; changesPercentage: string }) => ({
            sector: s.sector,
            changesPercentage: parseFloat(s.changesPercentage),
          }));
        }
      }
    }
  } catch { /* sectors optional */ }

  return {
    gainers: gainers.slice(0, 5),
    losers: losers.slice(0, 5),
    earnings: earnings.slice(0, 10),
    vix,
    sectors,
    marketContext,
  };
}

// ─── Build the enriched context string for Claude ─────────
function buildBriefingPromptContext(
  portfolio: Awaited<ReturnType<typeof gatherPortfolioData>>,
  market: Awaited<ReturnType<typeof gatherMarketData>>
): string {
  const parts: string[] = [];

  // Portfolio summary
  const dayPL = portfolio.day_pl;
  parts.push(`Alpaca Account:
  - Equity: $${portfolio.equity.toLocaleString()}
  - Cash: $${portfolio.cash.toLocaleString()}
  - Buying Power: $${portfolio.buying_power.toLocaleString()}
  - Day P&L: ${dayPL >= 0 ? '+' : ''}$${dayPL.toLocaleString()}`);

  if (portfolio.positions.length > 0) {
    parts.push(`Positions (${portfolio.positions.length}): $${portfolio.total_market_value.toLocaleString()} market value, ${portfolio.total_unrealized_pl >= 0 ? '+' : ''}$${portfolio.total_unrealized_pl.toLocaleString()} unrealized P&L`);
    // Top 5 positions by value
    const sorted = [...portfolio.positions].sort((a, b) => b.market_value - a.market_value).slice(0, 5);
    parts.push(`Top Holdings:\n${sorted.map(p =>
      `  - ${p.symbol}: $${p.market_value.toLocaleString()} (${p.unrealized_pl >= 0 ? '+' : ''}$${p.unrealized_pl.toLocaleString()}, ${(p.unrealized_plpc * 100).toFixed(1)}%)`
    ).join('\n')}`);
  }

  // Static holdings
  parts.push(`Static Holdings: CR3 equity ~$720K (23 territories), Anthropic RSUs 5,749 shares, Miami Shores ~$580K`);

  // VIX
  if (market.vix !== null) {
    parts.push(`VIX (Fear Index): ${market.vix.toFixed(2)}`);
  }

  // Sector performance
  if (market.sectors.length > 0) {
    const sorted = [...market.sectors].sort((a, b) =>
      Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage)
    );
    parts.push(`SECTOR PERFORMANCE:\n${sorted.slice(0, 5).map(s =>
      `  - ${s.sector}: ${s.changesPercentage >= 0 ? '+' : ''}${s.changesPercentage.toFixed(2)}%`
    ).join('\n')}`);
  }

  // Market intelligence (news, movers, earnings)
  if (market.marketContext && !market.marketContext.startsWith('Market data: No live')) {
    parts.push(`\nMARKET INTELLIGENCE:\n${market.marketContext}`);
  }

  return parts.join('\n\n');
}

// ─── POST: Generate and save scheduled briefing ───────────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Gather all data in parallel
    const [portfolio, market] = await Promise.all([
      gatherPortfolioData(),
      gatherMarketData([]), // symbols filled below after positions known
    ]);

    // Re-fetch market data with actual portfolio symbols for targeted news
    const portfolioSymbols = portfolio.positions.map(p => p.symbol);
    const enrichedMarket = portfolioSymbols.length > 0
      ? await gatherMarketData(portfolioSymbols)
      : market;

    // Build context and generate briefing via Claude
    const context = buildBriefingPromptContext(portfolio, enrichedMarket);
    const briefingContent = await generateBriefing(context);

    // Save to Supabase
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('briefings')
      .insert({
        content: briefingContent,
        market_data_json: {
          vix: enrichedMarket.vix,
          sectors: enrichedMarket.sectors,
          gainers: enrichedMarket.gainers,
          losers: enrichedMarket.losers,
          earnings: enrichedMarket.earnings.slice(0, 5),
        },
        portfolio_data_json: {
          equity: portfolio.equity,
          cash: portfolio.cash,
          buying_power: portfolio.buying_power,
          day_pl: portfolio.day_pl,
          positions: portfolio.positions,
          total_market_value: portfolio.total_market_value,
          total_unrealized_pl: portfolio.total_unrealized_pl,
        },
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase briefing insert error:', error);
      return NextResponse.json({ error: 'Failed to save briefing', details: error.message }, { status: 500 });
    }

    // Send push notification with briefing summary
    let pushSent = 0;
    try {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth');

      if (subs && subs.length > 0) {
        // Extract first line of briefing as summary
        const firstLine = briefingContent.split('\n').find((l: string) => l.trim().length > 10) || 'Your morning briefing is ready';
        const pushPayload = {
          title: '🌅 Morning Briefing',
          body: firstLine.replace(/[#*_]/g, '').trim().slice(0, 120),
          icon: '/icons/icon-192x192.png',
          url: '/keisha',
        };

        await Promise.all(
          subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
            const subscription: PushSubscriptionData = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            };
            const ok = await sendPushNotification(subscription, pushPayload);
            if (ok) pushSent++;
            if (!ok) {
              // Clean up expired subscriptions
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            }
          }),
        );
      }
    } catch (pushErr) {
      console.error('Push notification error:', pushErr);
    }

    return NextResponse.json({
      success: true,
      briefing: briefingContent,
      id: data.id,
      created_at: data.created_at,
      pushNotificationsSent: pushSent,
      context_summary: {
        positions_count: portfolio.positions.length,
        equity: portfolio.equity,
        vix: enrichedMarket.vix,
        sectors_count: enrichedMarket.sectors.length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scheduled briefing error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
