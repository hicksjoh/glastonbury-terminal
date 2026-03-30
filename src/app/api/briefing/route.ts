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
