import { NextRequest, NextResponse } from 'next/server';
import { generateAnalysis } from '@/lib/claude';
import { createServiceClient } from '@/lib/supabase';
import { buildMarketContext } from '@/lib/market-intel';

// ── Common words to exclude from symbol detection ────────────────────────────
const COMMON_WORDS = new Set([
  'I', 'A', 'THE', 'AND', 'OR', 'NOT', 'FOR', 'BUT', 'ALL', 'GET', 'SET',
  'HAS', 'NEW', 'USD', 'ETF', 'CEO', 'CFO', 'CTO', 'IPO', 'GDP', 'CPI',
  'FED', 'VIX', 'GEX', 'API', 'AM', 'PM', 'ANY', 'RUN', 'AI', 'IV', 'PE',
  'RSU', 'QBI', 'BUY', 'PUT', 'YES', 'MAY', 'NOW', 'DAY', 'TOP', 'LOW',
  'HIGH', 'GO', 'UP', 'SO', 'DO', 'MY', 'IF', 'ON', 'AT', 'TO', 'BE',
  'IN', 'IS', 'IT', 'NO', 'OF', 'BY', 'AS', 'WE', 'AN', 'HE', 'OK',
]);

// ── Topic keyword map for conversation tagging ───────────────────────────────
const TOPIC_KEYWORDS: Record<string, string[]> = {
  earnings: ['earnings', 'revenue', 'eps', 'guidance', 'quarter', 'beat', 'miss'],
  technical: ['support', 'resistance', 'trend', 'breakout', 'rsi', 'macd', 'volume'],
  macro: ['fed', 'rates', 'inflation', 'gdp', 'employment', 'cpi', 'yield'],
  risk: ['risk', 'hedge', 'stop', 'loss', 'drawdown', 'var', 'exposure'],
  portfolio: ['portfolio', 'position', 'allocation', 'rebalance', 'weight'],
  options: ['call', 'put', 'strike', 'expiry', 'iv', 'gamma', 'theta', 'spread'],
};

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
}

function extractSymbols(text: string): string[] {
  const matches = text.match(/\b[A-Z]{1,5}\b/g) || [];
  const filtered = matches.filter(s => !COMMON_WORDS.has(s) && s.length >= 2);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of filtered) {
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  }
  return unique;
}

function extractTopics(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([topic]) => topic);
}

// ── Alpaca context fetcher ───────────────────────────────────────────────────
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
    const optionsRes = await fetch(`${getBaseUrl()}/api/options/positions`, {
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

        const expiringSoon = optPositions.filter((p: { dte: number }) => p.dte <= 7);
        if (expiringSoon.length > 0) {
          optionsStr += `\n\n⚠️ EXPIRING SOON (≤7 DTE): ${expiringSoon.map((p: { underlying: string; dte: number; strike: number; contractType: string }) => `${p.underlying} $${p.strike}${p.contractType[0].toUpperCase()} (${p.dte}d)`).join(', ')}`;
        }
      }
    }
  } catch {
    // Options data not available
  }

  return `${accountStr}\n\n${positionsStr}\n\n${optionsStr}\n\n${ordersStr}`;
}

// ── Supabase context fetcher ─────────────────────────────────────────────────
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

// ── Feature 1: Track Record (past recommendations) ──────────────────────────
async function getTrackRecord(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  try {
    const { data: recs } = await (supabase as any).from('keisha_recommendations')
      .select('*')
      .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (!recs || recs.length === 0) return '';

    const total = recs.length;
    const resolved = recs.filter((r: any) => r.outcome && r.outcome !== 'pending');
    const wins = resolved.filter((r: any) => r.outcome === 'correct');
    const losses = resolved.filter((r: any) => r.outcome === 'incorrect');
    const hitRate = resolved.length > 0 ? ((wins.length / resolved.length) * 100).toFixed(0) : 'N/A';
    const avgWin = wins.length > 0
      ? (wins.reduce((s: number, r: any) => s + (r.return_pct || 0), 0) / wins.length).toFixed(1)
      : '0';
    const avgLoss = losses.length > 0
      ? (losses.reduce((s: number, r: any) => s + Math.abs(r.return_pct || 0), 0) / losses.length).toFixed(1)
      : '0';

    const best = resolved.reduce((a: any, b: any) => (b.return_pct || 0) > (a.return_pct || 0) ? b : a, resolved[0]);
    const worst = resolved.reduce((a: any, b: any) => (b.return_pct || 0) < (a.return_pct || 0) ? b : a, resolved[0]);

    // Trending: compare last 30d accuracy vs prior 60d
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    const recent = resolved.filter((r: any) => new Date(r.created_at).getTime() > thirtyDaysAgo);
    const older = resolved.filter((r: any) => new Date(r.created_at).getTime() <= thirtyDaysAgo);
    const recentHit = recent.length > 0 ? recent.filter((r: any) => r.outcome === 'correct').length / recent.length : 0;
    const olderHit = older.length > 0 ? older.filter((r: any) => r.outcome === 'correct').length / older.length : 0;
    const trending = recent.length < 3 ? 'insufficient data' : recentHit > olderHit + 0.05 ? 'improving' : recentHit < olderHit - 0.05 ? 'declining' : 'stable';

    return `\nYOUR TRACK RECORD (last 90 days):
- Total recommendations: ${total} (${resolved.length} resolved)
- Hit rate: ${wins.length}/${resolved.length} = ${hitRate}%
- Average return on correct calls: +${avgWin}%
- Average loss on incorrect calls: -${avgLoss}%
- Best call: ${best?.symbol || 'N/A'} +${(best?.return_pct || 0).toFixed(1)}% (${best?.created_at ? new Date(best.created_at).toLocaleDateString() : 'N/A'})
- Worst call: ${worst?.symbol || 'N/A'} ${(worst?.return_pct || 0).toFixed(1)}% (${worst?.created_at ? new Date(worst.created_at).toLocaleDateString() : 'N/A'})
- Trending: ${trending} accuracy over last 30 days

Reference your track record when making new recommendations.
If you have a poor hit rate on a sector, acknowledge it and adjust conviction.\n`;
  } catch {
    return '';
  }
}

// ── Feature 4: Behavioral Intelligence ──────────────────────────────────────
async function getBehavioralAlerts(
  supabase: ReturnType<typeof createServiceClient>,
  userMessage: string,
  gexRegime: string | null
): Promise<string> {
  const behavioralAlerts: string[] = [];
  let tradeCount = 0;
  let lossCount = 0;

  try {
    const todayStart = new Date().toISOString().split('T')[0];

    // Fetch recent trades
    const { data: trades } = await supabase.from('trades')
      .select('*')
      .gte('submitted_at', todayStart)
      .order('submitted_at', { ascending: false });

    const recentTrades = trades || [];
    tradeCount = recentTrades.length;
    const losses = recentTrades.filter((t: any) => (t.pnl || 0) < 0);
    lossCount = losses.length;

    // Revenge trading: 3+ trades within 1 hour after a loss
    if (losses.length > 0) {
      const lastLossTime = new Date(losses[0].submitted_at).getTime();
      const tradesAfterLoss = recentTrades.filter((t: any) =>
        new Date(t.submitted_at).getTime() > lastLossTime &&
        new Date(t.submitted_at).getTime() < lastLossTime + 3600000
      );
      if (tradesAfterLoss.length >= 3) {
        behavioralAlerts.push('REVENGE_TRADING');
      }
    }

    // Overtrading: >5 trades in a day
    if (tradeCount > 5) {
      behavioralAlerts.push('OVERTRADING');
    }

    // Fear selling during negative gamma
    const lower = userMessage.toLowerCase();
    if ((lower.includes('sell') || lower.includes('cut') || lower.includes('get out'))
        && gexRegime === 'negative') {
      behavioralAlerts.push('POSSIBLE_FEAR_SELLING');
    }
  } catch {
    // Non-critical
  }

  if (behavioralAlerts.length === 0) return '';

  const explanations = behavioralAlerts.map(a => {
    if (a === 'REVENGE_TRADING') return 'revenge trading after losses — he may be trying to "make it back" emotionally rather than strategically';
    if (a === 'OVERTRADING') return 'overtrading — too many positions being opened, likely reducing edge';
    if (a === 'POSSIBLE_FEAR_SELLING') return 'fear-based selling during market stress — check if fundamentals actually changed or if this is emotional';
    return a;
  }).join('; ');

  return `\n\nBEHAVIORAL ALERT: ${behavioralAlerts.join(', ')}
Wes has made ${tradeCount} trades today. ${lossCount} were losses.
Recent trading pattern suggests: ${explanations}.

YOUR ROLE: Be the voice of reason. Acknowledge his feelings, but redirect to data.
Reference the behavioral guard data. If the pattern is strong, suggest he step back for 30 minutes.
Do NOT enable impulsive decisions. Your job is to protect Wes from himself when emotions run hot.
Frame it supportively: "I see you, and I want to make sure we're making this decision with full clarity."\n`;
}

// ── Feature 5: Signal Calibration Context ───────────────────────────────────
async function getCalibrationContext(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  try {
    const { data } = await (supabase as any).from('signal_calibration')
      .select('*')
      .gte('sample_size', 3);

    if (!data || data.length === 0) return '';

    const topPerformer = data.reduce((a: any, b: any) =>
      (b.actual_precision || 0) > (a.actual_precision || 0) ? b : a
    );
    const worstPerformer = data.reduce((a: any, b: any) =>
      (b.actual_precision || 0) < (a.actual_precision || 0) ? b : a
    );

    return `\nSIGNAL CALIBRATION (based on your actual trading results):
${data.map((c: any) => `- ${c.source}: ${c.actual_precision}% precision (${c.sample_size} signals) → weight: ${c.recommended_weight}`).join('\n')}

When evaluating signals, weight them according to YOUR actual performance, not defaults.
Your best signal source is ${topPerformer.source}. Lean into it.
Your weakest is ${worstPerformer.source}. Be more skeptical of it.\n`;
  } catch {
    return '';
  }
}

// ── Feature 6: Conversation Memory ──────────────────────────────────────────
async function getConversationMemory(
  supabase: ReturnType<typeof createServiceClient>,
  symbols: string[]
): Promise<string> {
  if (symbols.length === 0) return '';

  try {
    const topSymbols = symbols.slice(0, 3);
    const { data: pastConvos } = await (supabase as any).from('keisha_conversations')
      .select('*')
      .overlaps('symbols_mentioned', topSymbols)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!pastConvos || pastConvos.length === 0) return '';

    return `\nPAST CONVERSATIONS about ${topSymbols.join(', ')}:
${pastConvos.map((c: any) => `[${new Date(c.created_at).toLocaleDateString()}] Wes asked: "${(c.user_message || '').slice(0, 100)}..." → You said (sentiment: ${c.sentiment || 'neutral'}): "${(c.keisha_response || '').slice(0, 150)}..."`).join('\n')}

Reference these past discussions naturally. If your view changed, explain WHY.
If Wes asked about this stock before, acknowledge the history: "Last time we talked about ${topSymbols[0]}..."\n`;
  } catch {
    return '';
  }
}

// ── Feature 8: Adaptive Personality ─────────────────────────────────────────
async function getPersonalityMode(
  supabase: ReturnType<typeof createServiceClient>,
  portfolio: any
): Promise<string> {
  const todayPnl = portfolio?.equity
    ? parseFloat(portfolio.equity) - parseFloat(portfolio.last_equity || portfolio.equity)
    : 0;
  const todayPnlPct = portfolio?.equity
    ? (todayPnl / parseFloat(portfolio.last_equity || portfolio.equity)) * 100
    : 0;

  const now = new Date();
  const utcHour = now.getUTCHours();
  const marketHours = utcHour >= 13 && utcHour < 20; // ~9:30-4 ET
  const isPreMarket = utcHour >= 10 && utcHour < 13;

  let tradeCount = 0;
  try {
    const todayStart = new Date().toISOString().split('T')[0];
    const { count } = await supabase.from('trades')
      .select('id', { count: 'exact', head: true })
      .gte('submitted_at', todayStart);
    tradeCount = count || 0;
  } catch { /* ignore */ }

  let personalityMode = 'standard';
  let personalityNote = '';

  if (todayPnlPct > 3) {
    personalityMode = 'celebrating';
    personalityNote = `We're up ${todayPnlPct.toFixed(1)}% today. You can be excited but remind Wes to stay disciplined. Don't let a green day lead to overconfidence.`;
  } else if (todayPnlPct < -3) {
    personalityMode = 'steady';
    personalityNote = `We're down ${Math.abs(todayPnlPct).toFixed(1)}% today. Be calm, empathetic, and data-focused. Frame losses as information, not failure. Reference risk management.`;
  } else if (isPreMarket) {
    personalityMode = 'strategic';
    personalityNote = `It's pre-market. Be forward-looking, brief, and focused on the game plan. Think morning huddle, not deep analysis.`;
  } else if (!marketHours && !isPreMarket) {
    personalityMode = 'reflective';
    personalityNote = `Markets are closed. Be more conversational, educational, reflective. Good time for strategy review, learning, and planning.`;
  } else if (tradeCount > 3) {
    personalityMode = 'watchful';
    personalityNote = `Wes has made ${tradeCount} trades today. Be slightly more cautious in recommendations. Gently check if he's trading from conviction or boredom.`;
  }

  const marketStatus = marketHours ? 'OPEN' : isPreMarket ? 'PRE-MARKET' : 'CLOSED';

  return `\nPERSONALITY MODE: ${personalityMode.toUpperCase()}
${personalityNote}
Today's P&L: ${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)} (${todayPnlPct >= 0 ? '+' : ''}${todayPnlPct.toFixed(1)}%)
Trades today: ${tradeCount}
Market status: ${marketStatus}\n`;
}

// ── Feature 9: Contrarian Radar ─────────────────────────────────────────────
async function getContrarianContext(symbols: string[]): Promise<string> {
  if (symbols.length === 0) return '';

  const baseUrl = getBaseUrl();
  const parts: string[] = [];

  for (const sym of symbols.slice(0, 2)) {
    try {
      const sentimentRes = await fetch(`${baseUrl}/api/sentiment?symbol=${sym}`).then(r => r.ok ? r.json() : null);
      if (sentimentRes?.overallSentiment) {
        const score = typeof sentimentRes.overallSentiment === 'number'
          ? sentimentRes.overallSentiment
          : parseFloat(sentimentRes.overallSentiment) || 0.5;

        if (score > 0.85) {
          parts.push(`\nCONTRARIAN ALERT for ${sym}: Sentiment score is ${(score * 100).toFixed(0)}% bullish — EXTREME optimism.
When everyone is bullish, smart money is often selling. Ask Wes: "What's the bear case?"
Historical data shows extreme bullish sentiment precedes corrections 60% of the time within 2 weeks.
Don't rain on his parade, but do your job: present the other side.`);
        } else if (score < 0.15) {
          parts.push(`\nCONTRARIAN ALERT for ${sym}: Sentiment score is ${(score * 100).toFixed(0)}% bullish — EXTREME fear/pessimism.
Maximum pessimism often marks bottoms. Warren Buffett: "Be greedy when others are fearful."
If fundamentals haven't changed, this could be a buying opportunity. Present the case.`);
        }
      }
    } catch { /* ignore */ }
  }

  return parts.join('\n');
}

// ── Feature 3: NLP Trade Detection ──────────────────────────────────────────
async function detectTradeIntent(response: string): Promise<string> {
  const tradeIntentRegex = /\b(buy|sell|short|cover|go long|go short|enter|exit|close|trim|add to)\b.*?\b([A-Z]{1,5})\b/gi;
  let match: RegExpExecArray | null = null;
  match = tradeIntentRegex.exec(response);

  if (!match) return '';

  const action = match[1].toLowerCase();
  const symbol = match[2];

  // Skip common words that aren't tickers
  if (COMMON_WORDS.has(symbol)) return '';

  const baseUrl = getBaseUrl();

  // Run crew + guard in background
  const [crewResult, guardResult] = await Promise.all([
    fetch(`${baseUrl}/api/agent-crew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, action: action.includes('buy') || action.includes('long') || action.includes('add') ? 'buy' : 'sell' }),
    }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${baseUrl}/api/trade-guard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, side: action.includes('buy') || action.includes('long') || action.includes('add') ? 'buy' : 'sell', quantity: 10, price: 0 }),
    }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  let tradeCard = `\n\n---\n**TRADE DETECTED: ${action.toUpperCase()} ${symbol}**\n`;
  if (crewResult) tradeCard += `Crew Verdict: ${crewResult.consensus || crewResult.decision || 'N/A'}\n`;
  if (guardResult) tradeCard += `Guard Check: ${guardResult.verdict || 'N/A'}\n`;
  tradeCard += `[Confirm & Execute] [Modify] [Cancel]`;

  return tradeCard;
}

// ── Feature 1: Log Recommendation ───────────────────────────────────────────
async function logRecommendation(
  supabase: ReturnType<typeof createServiceClient>,
  response: string
): Promise<void> {
  try {
    // Parse for direct recommendations
    const recPatterns = [
      /(?:I'd|I would|I recommend|my recommendation is to|you should)\s+(buy|sell|hold|avoid)\s+([A-Z]{1,5})/gi,
      /(?:strong buy|strong sell|buy rating|sell rating)\s+(?:on\s+)?([A-Z]{1,5})/gi,
    ];

    for (const pattern of recPatterns) {
      let match: RegExpExecArray | null = null;
      while ((match = pattern.exec(response)) !== null) {
        const recommendation = match[1]?.toLowerCase() || 'buy';
        const symbol = match[2] || match[1];
        if (COMMON_WORDS.has(symbol)) continue;

        // Extract conviction if present
        const convictionMatch = response.match(/conviction[:\s]*(\d+)/i);
        const conviction = convictionMatch ? parseInt(convictionMatch[1]) : null;

        // Fetch current price
        let price = null;
        try {
          const fmpKey = process.env.FMP_API_KEY;
          if (fmpKey) {
            const priceRes = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpKey}`);
            const priceData = await priceRes.json();
            if (Array.isArray(priceData) && priceData[0]?.price) {
              price = priceData[0].price;
            }
          }
        } catch { /* ignore */ }

        await (supabase as any).from('keisha_recommendations').insert({
          symbol,
          recommendation,
          conviction,
          reasoning: response.slice(0, 500),
          price_at_recommendation: price,
          outcome: 'pending',
        });
        return; // Only log the first recommendation per response
      }
    }
  } catch {
    // Non-critical
  }
}

// ── Feature 6: Log Conversation ─────────────────────────────────────────────
async function logConversation(
  supabase: ReturnType<typeof createServiceClient>,
  userMessage: string,
  keishaResponse: string
): Promise<void> {
  try {
    const combined = userMessage + ' ' + keishaResponse;
    const symbols = extractSymbols(combined).slice(0, 10);
    const topics = extractTopics(combined);
    const sentiment = keishaResponse.match(/bullish/i)
      ? 'bullish'
      : keishaResponse.match(/bearish/i)
        ? 'bearish'
        : 'neutral';

    await (supabase as any).from('keisha_conversations').insert({
      user_message: userMessage.slice(0, 2000),
      keisha_response: keishaResponse.slice(0, 5000),
      symbols_mentioned: symbols,
      sentiment,
      topics,
    });
  } catch {
    // Non-critical
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  POST Handler — Keisha Supreme
// ═════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const userMessage = messages[messages.length - 1]?.content || '';
    const supabase = createServiceClient();

    // ── Extract symbols from user message for memory + contrarian ────────
    const mentionedSymbols = extractSymbols(userMessage);

    // ── Fetch all context in parallel ───────────────────────────────────
    const alpacaContextPromise = getAlpacaContext();
    const supabaseContextPromise = getSupabaseContext();
    const trackRecordPromise = getTrackRecord(supabase);
    const conversationMemoryPromise = getConversationMemory(supabase, mentionedSymbols);
    const calibrationPromise = getCalibrationContext(supabase);
    const contrarianPromise = getContrarianContext(mentionedSymbols);

    const [alpacaContext, supabaseContext] = await Promise.all([
      alpacaContextPromise,
      supabaseContextPromise,
    ]);

    // Parse portfolio symbols from alpaca context for market intel
    const symbolMatches = alpacaContext.match(/- (\w+): \d+ shares/g) || [];
    const portfolioSymbols = symbolMatches.map(m => m.split(':')[0].replace('- ', '').trim());

    const marketContextPromise = buildMarketContext(portfolioSymbols);

    // Fetch v3 intelligence + portfolio account for personality
    const baseUrl = getBaseUrl();
    const [gexRes, macroRes, driftRes, accountRes] = await Promise.all([
      fetch(`${baseUrl}/api/gex?symbol=SPY`).catch(() => null),
      fetch(`${baseUrl}/api/macro`).catch(() => null),
      fetch(`${baseUrl}/api/drift`).catch(() => null),
      fetch(`${process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
        },
      }).catch(() => null),
    ]);

    let gexContext = '';
    let gexRegime: string | null = null;
    let macroContext = '';
    let driftContext = '';

    if (gexRes?.ok) {
      const gex = await gexRes.json();
      gexRegime = gex.regime;
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

    // ── Await remaining parallel context ────────────────────────────────
    const [
      marketContext,
      trackRecord,
      conversationMemory,
      calibration,
      contrarian,
      behavioralAlerts,
      personalityMode,
    ] = await Promise.all([
      marketContextPromise,
      trackRecordPromise,
      conversationMemoryPromise,
      calibrationPromise,
      contrarianPromise,
      getBehavioralAlerts(supabase, userMessage, gexRegime),
      getPersonalityMode(supabase, accountRes?.ok ? await accountRes.clone().json().catch(() => null) : null),
    ]);

    // ── Build enriched portfolio context ────────────────────────────────
    const portfolioContext = `\nALPACA BROKERAGE (LIVE):\n${alpacaContext}\n\nMARKET INTELLIGENCE (LIVE):\n${marketContext}${gexContext}${macroContext}${driftContext}\n\nGLASTONBURY TERMINAL DATABASE:\n${supabaseContext}\n\nSTATIC HOLDINGS (not in brokerage):\n  - CR3 American Exteriors equity: ~$720,000 (23 territories)\n  - Anthropic RSUs: 5,749 shares @ $259.14 grant (quarterly vesting, 4 years)\n  - Miami Shores property: ~$580,000\n${trackRecord}${conversationMemory}${calibration}${contrarian}${behavioralAlerts}${personalityMode}`;

    // ── Generate response ───────────────────────────────────────────────
    let content = await generateAnalysis(
      userMessage,
      portfolioContext,
      messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
    );

    // ── Feature 3: NLP Trade Detection (post-processing) ────────────────
    const tradeCard = await detectTradeIntent(content);
    if (tradeCard) {
      content += tradeCard;
    }

    // ── Feature 1 & 6: Log recommendation + conversation (background) ──
    logRecommendation(supabase, content).catch(() => {});
    logConversation(supabase, userMessage, content).catch(() => {});

    return NextResponse.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keisha API error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
