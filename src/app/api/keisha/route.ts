import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';

async function getAlpacaContext(): Promise<string> {
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
  };

  let accountStr = 'Alpaca account: Not connected';
  let positionsStr = 'Positions: None';
  let ordersStr = 'Recent orders: None';

  try {
    const [accountRes, positionsRes, ordersRes] = await Promise.all([
      fetch(`${baseUrl}/v2/account`, { headers }),
      fetch(`${baseUrl}/v2/positions`, { headers }),
      fetch(`${baseUrl}/v2/orders?status=all&limit=10`, { headers }),
    ]);

    if (accountRes.ok) {
      const acct = await accountRes.json();
      accountStr = `Alpaca Account:\n  - Equity: $${parseFloat(acct.equity).toLocaleString()}\n  - Cash: $${parseFloat(acct.cash).toLocaleString()}\n  - Buying Power: $${parseFloat(acct.buying_power).toLocaleString()}\n  - Portfolio Value: $${parseFloat(acct.portfolio_value).toLocaleString()}\n  - Account Status: ${acct.status}\n  - Pattern Day Trader: ${acct.pattern_day_trader ? 'Yes' : 'No'}\n  - Trading Blocked: ${acct.trading_blocked ? 'YES' : 'No'}`;
    }

    if (positionsRes.ok) {
      const positions = await positionsRes.json();
      if (positions.length > 0) {
        const totalMV = positions.reduce((s: number, p: { market_value: string }) => s + parseFloat(p.market_value), 0);
        const totalPL = positions.reduce((s: number, p: { unrealized_pl: string }) => s + parseFloat(p.unrealized_pl), 0);
        positionsStr = `Positions (${positions.length} total, $${totalMV.toLocaleString()} market value, $${totalPL >= 0 ? '+' : ''}${totalPL.toLocaleString()} unrealized P&L):\n${positions.map((p: { symbol: string; qty: string; current_price: string; market_value: string; unrealized_pl: string; unrealized_plpc: string; side: string; cost_basis: string }) => `  - ${p.symbol}: ${p.qty} shares @ $${parseFloat(p.current_price).toFixed(2)} | Value: $${parseFloat(p.market_value).toLocaleString()} | P&L: $${parseFloat(p.unrealized_pl) >= 0 ? '+' : ''}${parseFloat(p.unrealized_pl).toLocaleString()} (${(parseFloat(p.unrealized_plpc) * 100).toFixed(1)}%) | Side: ${p.side}`).join('\n')}`;
      }
    }

    if (ordersRes.ok) {
      const orders = await ordersRes.json();
      if (orders.length > 0) {
        ordersStr = `Recent Orders (last ${orders.length}):\n${orders.slice(0, 10).map((o: { symbol: string; side: string; qty: string; type: string; status: string; filled_avg_price?: string; submitted_at: string; limit_price?: string }) => `  - ${o.side.toUpperCase()} ${o.qty} ${o.symbol} (${o.type}${o.limit_price ? ' @ $' + o.limit_price : ''}) — ${o.status}${o.filled_avg_price ? ' @ $' + o.filled_avg_price : ''} — ${new Date(o.submitted_at).toLocaleDateString()}`).join('\n')}`;
      }
    }
  } catch (err) {
    console.error('Alpaca context fetch error:', err);
  }

  return `${accountStr}\n\n${positionsStr}\n\n${ordersStr}`;
}

async function getSupabaseContext(): Promise<string> {
  const supabase = createServiceClient();
  const parts: string[] = [];

  try {
    const { data: strategies } = await supabase.from('strategies').select('*').order('created_at', { ascending: false });
    if (strategies && strategies.length > 0) {
      parts.push(`Active Strategies (${strategies.length}):\n${strategies.map((s: { name: string; type: string; status: string; total_return: number; total_return_pct: number; trades_executed: number }) => `  - ${s.name} (${s.type}) — Status: ${s.status} | Return: $${s.total_return?.toLocaleString() || '0'} (${s.total_return_pct?.toFixed(1) || '0'}%) | Trades: ${s.trades_executed || 0}`).join('\n')}`);
    }

    const { data: watchlist } = await supabase.from('watchlist').select('*').order('created_at', { ascending: false }).limit(15);
    if (watchlist && watchlist.length > 0) {
      parts.push(`Watchlist (${watchlist.length} items):\n${watchlist.map((w: { symbol: string; company_name: string; current_price: number; fair_value: number; moat: string; stars: number }) => `  - ${w.symbol} (${w.company_name}) — Price: $${w.current_price?.toFixed(2) || 'N/A'} | Fair Value: $${w.fair_value?.toFixed(2) || 'N/A'} | Moat: ${w.moat || 'N/A'}`).join('\n')}`);
    }

    const { data: roadmap } = await supabase.from('roadmap_entries').select('*').order('year', { ascending: true });
    if (roadmap && roadmap.length > 0) {
      const currentYear = new Date().getFullYear();
      const thisYear = roadmap.find((r: { year: number }) => r.year === currentYear);
      const totalActual = roadmap.reduce((s: number, r: { actual?: number }) => s + (r.actual || 0), 0);
      parts.push(`$50M Roadmap Progress:\n  - ${currentYear} Target: $${thisYear?.projected?.toLocaleString() || 'N/A'} | Actual: $${thisYear?.actual?.toLocaleString() || 'Not yet recorded'}\n  - Progress: ${totalActual > 0 ? ((totalActual / 50000000) * 100).toFixed(2) + '% toward $50M' : 'Tracking not started'}`);
    }

    const { data: snapshots } = await supabase.from('portfolio_snapshots').select('*').order('date', { ascending: false }).limit(5);
    if (snapshots && snapshots.length > 0) {
      parts.push(`Recent Portfolio Snapshots:\n${snapshots.map((s: { date: string; total_equity: number; cash: number; pnl: number; cr3_value: number; rsu_value: number }) => `  - ${new Date(s.date).toLocaleDateString()}: Equity $${s.total_equity?.toLocaleString()} | Cash $${s.cash?.toLocaleString()} | P&L $${s.pnl >= 0 ? '+' : ''}${s.pnl?.toLocaleString()}`).join('\n')}`);
    }

    const { data: trades } = await supabase.from('trades').select('*').order('submitted_at', { ascending: false }).limit(10);
    if (trades && trades.length > 0) {
      parts.push(`Logged Trades (${trades.length} recent):\n${trades.map((t: { symbol: string; side: string; qty: number; order_type: string; status: string; filled_avg_price?: number; submitted_at: string }) => `  - ${t.side.toUpperCase()} ${t.qty} ${t.symbol} (${t.order_type}) — ${t.status}${t.filled_avg_price ? ' @ $' + t.filled_avg_price : ''} — ${new Date(t.submitted_at).toLocaleDateString()}`).join('\n')}`);
    }

    const { data: auditLog } = await supabase.from('audit_log').select('*').order('timestamp', { ascending: false }).limit(5);
    if (auditLog && auditLog.length > 0) {
      parts.push(`Recent System Activity:\n${auditLog.map((a: { agent: string; action: string; details: string; status: string }) => `  - [${a.agent}] ${a.action}: ${a.details} (${a.status})`).join('\n')}`);
    }
  } catch (err) {
    console.error('Supabase context fetch error:', err);
    parts.push('Supabase data: Connection error — using cached data');
  }

  return parts.length > 0 ? parts.join('\n\n') : 'No Supabase data available yet — tables may be empty.';
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const [alpacaContext, supabaseContext] = await Promise.all([getAlpacaContext(), getSupabaseContext()]);

    const portfolioContext = `\nALPACA BROKERAGE (LIVE):\n${alpacaContext}\n\nGLASTONBURY TERMINAL DATABASE:\n${supabaseContext}\n\nSTATIC HOLDINGS (not in brokerage):\n  - CR3 American Exteriors equity: ~$720,000 (23 territories)\n  - Anthropic RSUs: 5,749 shares @ $259.14 grant (quarterly vesting, 4 years)\n  - Miami Shores property: ~$580,000\n`;

    const content = await generateAnalysis(
      messages[messages.length - 1]?.content || '',
      portfolioContext,
      messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
    );

    return NextResponse.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
