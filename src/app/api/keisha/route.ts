import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { buildMarketContext } from '@/lib/market-intel';

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

  // Fetch options positions + Greeks
  let optionsStr = 'Options Positions: None';
  try {
    const optionsRes = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/options/positions`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (optionsRes.ok) {
      const optData = await optionsRes.json();
      const optPositions = optData.positions || [];
      const greeks = optData.greeks;

      if (optPositions.length > 0) {
        optionsStr = `Options Positions (${optPositions.length}):\n${optPositions.map((p: { underlying: string; contractType: string; strike: number; expiration: string; direction: string; quantity: number; pnl: number; dte: number; delta: number; theta: number }) =>
          `  - ${p.underlying} ${p.expiration} $${p.strike} ${p.contractType.toUpperCase()} | ${p.direction} ${p.quantity}x | P&L: $${p.pnl.toFixed(0)} | DTE: ${p.dte} | Delta: ${p.delta.toFixed(2)} | Theta: $${p.theta.toFixed(2)}/day`
        ).join('\n')}`;

        if (greeks) {
          optionsStr += `\n\nPortfolio Greeks:\n  - Net Delta: ${greeks.netDelta.toFixed(2)} (≈${greeks.sharesEquivalent} shares equivalent)\n  - Daily Theta: $${greeks.netTheta.toFixed(2)} ($${greeks.monthlyTheta.toFixed(0)}/month)\n  - Net Gamma: ${greeks.netGamma.toFixed(3)}\n  - Net Vega: ${greeks.netVega.toFixed(2)}`;
        }

        // Flag expiring positions
        const expiringSoon = optPositions.filter((p: { dte: number }) => p.dte <= 7);
        if (expiringSoon.length > 0) {
          optionsStr += `\n\n⚠️ EXPIRING SOON (≤7 DTE): ${expiringSoon.map((p: { underlying: string; dte: number; strike: number; contractType: string }) => `${p.underlying} $${p.strike}${p.contractType[0].toUpperCase()} (${p.dte}d)`).join(', ')}`;
        }
      }
    }
  } catch {
    // Options data not available — continue without it
  }

  return `${accountStr}\n\n${positionsStr}\n\n${optionsStr}\n\n${ordersStr}`;
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

    // Fetch brokerage + database context in parallel
    const alpacaContext = await getAlpacaContext();
    const supabaseContext = await getSupabaseContext();

    // Parse portfolio symbols from alpaca context for targeted market intel
    const symbolMatches = alpacaContext.match(/- (\w+): \d+ shares/g) || [];
    const portfolioSymbols = symbolMatches.map(m => m.split(':')[0].replace('- ', '').trim());

    const marketContext = await buildMarketContext(portfolioSymbols);

    // Fetch v3 intelligence signals in parallel
    let gexContext = '';
    let macroContext = '';
    let driftContext = '';

    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

      const [gexRes, macroRes, driftRes] = await Promise.all([
        fetch(`${baseUrl}/api/gex?symbol=SPY`).catch(() => null),
        fetch(`${baseUrl}/api/macro`).catch(() => null),
        fetch(`${baseUrl}/api/drift`).catch(() => null),
      ]);

      if (gexRes?.ok) {
        const gex = await gexRes.json();
        gexContext = `\nGEX INTELLIGENCE:\n  - SPY GEX Regime: ${gex.regime}\n  - Net GEX: ${gex.netGEX}\n  - Put Wall: ${gex.levels?.putWall} | Call Wall: ${gex.levels?.callWall}\n  - Gamma Flip: ${gex.levels?.gammaFlip}\n  - Impact: ${gex.impact}\n`;
      }

      if (macroRes?.ok) {
        const macro = await macroRes.json();
        macroContext = `\nMACRO REGIME:\n  - Current Regime: ${macro.regime?.regime} (${(macro.regime?.confidence * 100).toFixed(0)}% confidence)\n  - Fed Prediction: ${macro.fedPrediction?.prediction} (confidence: ${(macro.fedPrediction?.confidence * 100).toFixed(0)}%)\n  - Allocation: Equities ${macro.allocation?.equities}%, Bonds ${macro.allocation?.bonds}%, Cash ${macro.allocation?.cash}%\n  - Interpretation: ${macro.interpretation}\n`;
      }

      if (driftRes?.ok) {
        const drift = await driftRes.json();
        const topDrifts = (drift.scans || []).slice(0, 5);
        driftContext = `\nDRIFT REGIMES:\n${topDrifts.map((d: any) => `  - ${d.symbol}: ${d.regime} (Hurst: ${d.hurstExponent?.toFixed(3)}, Confidence: ${(d.confidence * 100).toFixed(0)}%)`).join('\n')}\n`;
      }
    } catch {
      // V3 intelligence not available — continue without it
    }

    const portfolioContext = `\nALPACA BROKERAGE (LIVE):\n${alpacaContext}\n\nMARKET INTELLIGENCE (LIVE):\n${marketContext}${gexContext}${macroContext}${driftContext}\n\nGLASTONBURY TERMINAL DATABASE:\n${supabaseContext}\n\nSTATIC HOLDINGS (not in brokerage):\n  - CR3 American Exteriors equity: ~$720,000 (23 territories)\n  - Anthropic RSUs: 5,749 shares @ $259.14 grant (quarterly vesting, 4 years)\n  - Miami Shores property: ~$580,000\n`;

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
