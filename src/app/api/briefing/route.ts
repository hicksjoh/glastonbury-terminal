import { NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { buildMarketContext } from '@/lib/market-intel';

async function getBriefingContext(): Promise<string> {
  const parts: string[] = [];

  // Fetch live Alpaca account data
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };

  try {
    const [accountRes, positionsRes] = await Promise.all([
      fetch(`${baseUrl}/v2/account`, { headers }),
      fetch(`${baseUrl}/v2/positions`, { headers }),
    ]);

    if (accountRes.ok) {
      const acct = await accountRes.json();
      const dayPL = parseFloat(acct.equity) - parseFloat(acct.last_equity);
      parts.push(`Alpaca Account:
  - Equity: $${parseFloat(acct.equity).toLocaleString()}
  - Cash: $${parseFloat(acct.cash).toLocaleString()}
  - Buying Power: $${parseFloat(acct.buying_power).toLocaleString()}
  - Day P&L: ${dayPL >= 0 ? '+' : ''}$${dayPL.toLocaleString()}`);
    }

    if (positionsRes.ok) {
      const positions = await positionsRes.json();
      if (Array.isArray(positions) && positions.length > 0) {
        const totalValue = positions.reduce((s: number, p: { market_value: string }) => s + parseFloat(p.market_value), 0);
        const totalPL = positions.reduce((s: number, p: { unrealized_pl: string }) => s + parseFloat(p.unrealized_pl), 0);
        parts.push(`Positions (${positions.length}): $${totalValue.toLocaleString()} market value, ${totalPL >= 0 ? '+' : ''}$${totalPL.toLocaleString()} unrealized P&L`);
      }
    }
  } catch {
    parts.push('Alpaca: Connection unavailable');
  }

  // Fetch Supabase portfolio snapshot + roadmap
  try {
    const supabase = createServiceClient();

    const { data: snapshots } = await supabase
      .from('portfolio_snapshots')
      .select('*')
      .order('date', { ascending: false })
      .limit(1);

    if (snapshots && snapshots.length > 0) {
      const s = snapshots[0];
      parts.push(`Latest Snapshot (${s.date}): Equity $${s.total_equity?.toLocaleString()} | CR3 $${s.cr3_value?.toLocaleString()} | RSU $${s.rsu_value?.toLocaleString()} | Property $${s.property_value?.toLocaleString()}`);
    }

    const { data: roadmap } = await supabase
      .from('roadmap_entries')
      .select('*')
      .eq('year', new Date().getFullYear())
      .limit(1);

    if (roadmap && roadmap.length > 0) {
      const r = roadmap[0];
      parts.push(`${r.year} Target: $${r.projected?.toLocaleString()} | Actual: $${r.actual?.toLocaleString() || 'Not yet recorded'} (${r.engine})`);
    }
  } catch {
    parts.push('Supabase: Connection unavailable');
  }

  // Static holdings always included
  parts.push(`Static Holdings: CR3 equity ~$720K (23 territories), Anthropic RSUs 5,749 shares, Miami Shores ~$580K`);

  // Fetch market intelligence (news, movers, earnings)
  try {
    const marketIntel = await buildMarketContext([]);
    if (marketIntel && !marketIntel.startsWith('Market data: No live')) {
      parts.push(`\nMARKET INTELLIGENCE:\n${marketIntel}`);
    }
  } catch {
    parts.push('Market intelligence: Unavailable');
  }

  // Aggregate news sentiment (last 12 hours)
  try {
    const newsRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/news?limit=30`);
    if (newsRes.ok) {
      const newsData = await newsRes.json();
      const articles = newsData.articles || [];
      if (articles.length > 0) {
        // Score headlines via sentiment API
        const sentRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/sentiment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headlines: articles.slice(0, 20).map((a: { headline: string }) => a.headline) }),
        });
        if (sentRes.ok) {
          const sentData = await sentRes.json();
          const results = sentData.results || [];
          const bullish = results.filter((r: { sentiment: string }) => r.sentiment === 'BULLISH').length;
          const bearish = results.filter((r: { sentiment: string }) => r.sentiment === 'BEARISH').length;
          const neutral = results.filter((r: { sentiment: string }) => r.sentiment === 'NEUTRAL').length;
          const total = results.length;
          if (total > 0) {
            parts.push(`\nNEWS SENTIMENT (${total} headlines): ${Math.round((bullish/total)*100)}% Bullish, ${Math.round((neutral/total)*100)}% Neutral, ${Math.round((bearish/total)*100)}% Bearish`);
          }
        }
      }
    }
  } catch {
    // Sentiment data unavailable for briefing — not critical
  }

  // Fetch active alerts
  try {
    const alertsRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/alerts`);
    if (alertsRes.ok) {
      const alertsData = await alertsRes.json();
      const activeAlerts = (alertsData.alerts || []).filter((a: { is_active: boolean }) => a.is_active);
      if (activeAlerts.length > 0) {
        parts.push(`\nACTIVE ALERTS: ${activeAlerts.length} alert rules active`);
        const triggered = activeAlerts.filter((a: { last_triggered: string | null }) => a.last_triggered);
        if (triggered.length > 0) {
          parts.push(`  ${triggered.length} triggered recently`);
        }
      }
    }
  } catch {
    // Alerts data unavailable — not critical
  }

  // Fetch top sector movers
  try {
    const sectorsRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/sectors`);
    if (sectorsRes.ok) {
      const sectorsData = await sectorsRes.json();
      const sectors = sectorsData.sectors || [];
      if (sectors.length > 0) {
        const sorted = [...sectors].sort((a: { changesPercentage: string }, b: { changesPercentage: string }) =>
          Math.abs(parseFloat(b.changesPercentage)) - Math.abs(parseFloat(a.changesPercentage))
        );
        const top3 = sorted.slice(0, 3);
        parts.push(`\nTOP SECTOR MOVERS: ${top3.map((s: { sector: string; changesPercentage: string }) =>
          `${s.sector} ${parseFloat(s.changesPercentage) >= 0 ? '+' : ''}${s.changesPercentage}%`
        ).join(', ')}`);
      }
    }
  } catch {
    // Sector data unavailable — not critical
  }

  return parts.join('\n');
}

export async function GET() {
  try {
    const context = await getBriefingContext();
    const briefing = await generateBriefing(context);
    return NextResponse.json({ briefing, generatedAt: new Date().toISOString() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
