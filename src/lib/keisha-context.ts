import { createServiceClient } from '@/lib/supabase';
import { buildMarketContext } from '@/lib/market-intel';

// ── Common words to exclude from symbol detection ────────────────────────────
export const COMMON_WORDS = new Set([
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

export function extractSymbols(text: string): string[] {
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

export function extractTopics(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => lower.includes(kw)))
    .map(([topic]) => topic);
}

// ── Smart Context Pruning ──────────────────────────────────────────────────────
export interface ContextNeeds {
  needsAlpaca: boolean;
  needsSupabase: boolean;
  needsTrackRecord: boolean;
  needsBehavioral: boolean;
  needsCalibration: boolean;
  needsConversationMemory: boolean;
  needsContrarianRadar: boolean;
  needsMarketIntel: boolean;
  needsGex: boolean;
  needsMacro: boolean;
  needsDrift: boolean;
  needsPersonality: boolean;
}

export function pruneContext(userMessage: string, domain: string): ContextNeeds {
  const lower = userMessage.toLowerCase().trim();

  // Start with everything off
  const needs: ContextNeeds = {
    needsAlpaca: false,
    needsSupabase: false,
    needsTrackRecord: false,
    needsBehavioral: false,
    needsCalibration: false,
    needsConversationMemory: false,
    needsContrarianRadar: false,
    needsMarketIntel: false,
    needsGex: false,
    needsMacro: false,
    needsDrift: false,
    needsPersonality: false,
  };

  // Simple greetings
  const greetings = /^(hi|hey|hello|what'?s up|sup|yo|good morning|good evening|good afternoon|gm|howdy)\s*[!?.]*$/i;
  if (greetings.test(lower)) {
    needs.needsPersonality = true;
    return applyDomainOverrides(needs, domain);
  }

  // Trade intent keywords — full context
  const tradeIntentWords = /\b(buy|sell|enter|exit|execute|short|cover|go long|go short|trim|add to|close position|open position)\b/i;
  if (tradeIntentWords.test(lower)) {
    // ALL context for trade intent
    Object.keys(needs).forEach(k => (needs as any)[k] = true);
    return applyDomainOverrides(needs, domain);
  }

  // Emotional / behavioral triggers
  const emotionalWords = /\b(scared|nervous|worried|panicking|freaking out|losing|dump|crash|wrecked|bleeding|pain|fear|revenge|fomo|yolo)\b/i;
  if (emotionalWords.test(lower)) {
    needs.needsBehavioral = true;
    needs.needsPersonality = true;
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
  }

  // Specific stock questions (contains ticker-like patterns)
  const hasSymbols = extractSymbols(userMessage).length > 0;
  if (hasSymbols) {
    needs.needsAlpaca = true;
    needs.needsConversationMemory = true;
    needs.needsContrarianRadar = true;
    needs.needsMarketIntel = true;
  }

  // Portfolio / position questions
  if (/\b(portfolio|positions?|holdings?|account|balance|allocation|weight)\b/i.test(lower)) {
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
  }

  // Tax questions
  if (/\b(tax|taxes|tax-loss|harvesting|wash sale|1099|capital gains|deduction|write.?off)\b/i.test(lower)) {
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
  }

  // Risk questions
  if (/\b(risk|var|drawdown|stress test|hedge|exposure|volatility|beta|sharpe)\b/i.test(lower)) {
    needs.needsAlpaca = true;
    needs.needsGex = true;
    needs.needsMacro = true;
    needs.needsMarketIntel = true;
  }

  // Strategy / roadmap questions
  if (/\b(strategy|roadmap|plan|calibrat|track record|performance|backtest|signal)\b/i.test(lower)) {
    needs.needsSupabase = true;
    needs.needsTrackRecord = true;
    needs.needsCalibration = true;
  }

  // Wealth / net worth
  if (/\b(wealth|net worth|50m|fifty million|\$50|total value|empire)\b/i.test(lower)) {
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
  }

  // If nothing specific matched, apply general defaults
  const anySet = Object.values(needs).some(v => v);
  if (!anySet) {
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
    needs.needsPersonality = true;
    needs.needsMarketIntel = true;
  }

  return applyDomainOverrides(needs, domain);
}

function applyDomainOverrides(needs: ContextNeeds, domain: string): ContextNeeds {
  if (domain === 'quant') {
    needs.needsGex = true;
    needs.needsMacro = true;
    needs.needsDrift = true;
  }
  if (domain === 'cfo') {
    needs.needsAlpaca = true;
    needs.needsSupabase = true;
  }
  if (domain === 'tax') {
    needs.needsSupabase = true;
  }
  return needs;
}

// ── Alpaca context fetcher ───────────────────────────────────────────────────
export async function getAlpacaContext(): Promise<string> {
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
export async function getSupabaseContext(): Promise<string> {
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
export async function getTrackRecord(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
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
export async function getBehavioralAlerts(
  supabase: ReturnType<typeof createServiceClient>,
  userMessage: string,
  gexRegime: string | null
): Promise<string> {
  const behavioralAlerts: string[] = [];
  let tradeCount = 0;
  let lossCount = 0;

  try {
    const todayStart = new Date().toISOString().split('T')[0];

    const { data: trades } = await supabase.from('trades')
      .select('*')
      .gte('submitted_at', todayStart)
      .order('submitted_at', { ascending: false });

    const recentTrades = trades || [];
    tradeCount = recentTrades.length;
    const losses = recentTrades.filter((t: any) => (t.pnl || 0) < 0);
    lossCount = losses.length;

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

    if (tradeCount > 5) {
      behavioralAlerts.push('OVERTRADING');
    }

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
export async function getCalibrationContext(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
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
export async function getConversationMemory(
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
export async function getPersonalityMode(
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
  const marketHours = utcHour >= 13 && utcHour < 20;
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
export async function getContrarianContext(symbols: string[]): Promise<string> {
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
export async function detectTradeIntent(response: string): Promise<string> {
  const tradeIntentRegex = /\b(buy|sell|short|cover|go long|go short|enter|exit|close|trim|add to)\b.*?\b([A-Z]{1,5})\b/gi;
  let match: RegExpExecArray | null = null;
  match = tradeIntentRegex.exec(response);

  if (!match) return '';

  const action = match[1].toLowerCase();
  const symbol = match[2];

  if (COMMON_WORDS.has(symbol)) return '';

  const baseUrl = getBaseUrl();

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
export async function logRecommendation(
  supabase: ReturnType<typeof createServiceClient>,
  response: string
): Promise<void> {
  try {
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

        const convictionMatch = response.match(/conviction[:\s]*(\d+)/i);
        const conviction = convictionMatch ? parseInt(convictionMatch[1]) : null;

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
        return;
      }
    }
  } catch {
    // Non-critical
  }
}

// ── Feature 6: Log Conversation ─────────────────────────────────────────────
export async function logConversation(
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

// ── Suggestion Parser ───────────────────────────────────────────────────────
export function parseSuggestions(text: string): { cleanText: string; suggestions: string[] } {
  const suggestionsMatch = text.match(/<suggestions>\s*([\s\S]*?)\s*<\/suggestions>/);
  if (!suggestionsMatch) {
    return { cleanText: text, suggestions: [] };
  }

  const cleanText = text.replace(/<suggestions>[\s\S]*?<\/suggestions>/, '').trim();
  const suggestionsBlock = suggestionsMatch[1];
  const suggestions = suggestionsBlock
    .split('\n')
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(line => line.length > 0)
    .slice(0, 3);

  return { cleanText, suggestions };
}

// ── Action System ─────────────────────────────────────────────────────────────
export const ACTION_PROMPT_SUFFIX = `

═══════════════════════════════════════════
  EXECUTABLE ACTIONS
═══════════════════════════════════════════

You can EXECUTE actions for Wes by including action tags in your response. When Wes asks you to do something (not just analyze), include the appropriate action tag:

<action type="add_watchlist" symbol="NVDA" />
<action type="remove_watchlist" symbol="TSLA" />
<action type="set_alert" symbol="AAPL" condition="price_below" value="170" />
<action type="set_alert" symbol="NVDA" condition="price_above" value="1000" />
<action type="place_order" symbol="AAPL" side="buy" qty="10" orderType="market" />
<action type="place_order" symbol="MSFT" side="sell" qty="5" orderType="limit" limitPrice="450" />
<action type="lookup_price" symbol="TSLA" />
<action type="get_position" symbol="AAPL" />
<action type="update_watchlist_target" symbol="NVDA" buyTarget="800" sellTarget="1200" />
<action type="portfolio_summary" />

RULES FOR ACTIONS:
- Only include action tags when Wes explicitly asks you to DO something ("add NVDA to watchlist", "set an alert", "buy 10 shares")
- For orders (place_order), ALWAYS confirm with Wes first before including the tag — say what you'll do and include the tag
- For non-destructive actions (lookups, watchlist adds, alerts), you can execute immediately
- You can include MULTIPLE action tags in one response
- Always explain what you're doing alongside the action tag
- If an action seems risky (large order, unfamiliar symbol), warn Wes first`;

// ── Suggestion System Prompt Suffix ─────────────────────────────────────────
export const SUGGESTION_PROMPT_SUFFIX = `

After your main response, on a new line, output exactly this format:
<suggestions>
1. [short follow-up question relevant to what we just discussed]
2. [short follow-up question that digs deeper or explores a related angle]
3. [short follow-up question about a different but relevant topic]
</suggestions>`;

// ── Action Parser ─────────────────────────────────────────────────────────────
export interface ParsedAction {
  type: string;
  params: Record<string, string>;
}

export function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const actionRegex = /<action\s+([^/]*?)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = actionRegex.exec(text)) !== null) {
    const attrStr = match[1];
    const params: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      params[attrMatch[1]] = attrMatch[2];
    }
    if (params.type) {
      const type = params.type;
      delete params.type;
      actions.push({ type, params });
    }
  }

  const cleanText = text.replace(/<action\s+[^/]*?\/>\s*/g, '').trim();
  return { cleanText, actions };
}

// ── Build full portfolio context (shared by both routes) ────────────────────
export async function buildFullPortfolioContext(opts: {
  userMessage: string;
  domain: string;
  conversationId?: string;
  messages?: { role: string; content: string }[];
}): Promise<{
  portfolioContext: string;
  gexRegime: string | null;
  mentionedSymbols: string[];
  supabase: ReturnType<typeof createServiceClient>;
}> {
  const { userMessage, domain, conversationId } = opts;
  const supabase = createServiceClient();
  const needs = pruneContext(userMessage, domain);
  const mentionedSymbols = extractSymbols(userMessage);

  // ── Memory context: last 3 conversations for this persona ──────────
  let memoryPreamble = '';
  if (domain) {
    try {
      const { data: recentSessions } = await supabase
        .from('keisha_chat_sessions')
        .select('messages_json, updated_at')
        .eq('persona', domain)
        .order('updated_at', { ascending: false })
        .limit(4);

      if (recentSessions && recentSessions.length > 0) {
        const summaries = recentSessions
          .filter((s: any) => s.id !== conversationId)
          .slice(0, 3)
          .map((s: any) => {
            const msgs = s.messages_json || [];
            const lastUserMsg = [...msgs].reverse().find((m: any) => m.role === 'user');
            const lastAssistantMsg = [...msgs].reverse().find((m: any) => m.role === 'assistant');
            const date = new Date(s.updated_at).toLocaleDateString();
            const userPreview = lastUserMsg?.content?.slice(0, 120) || 'N/A';
            const assistantPreview = lastAssistantMsg?.content?.slice(0, 120) || 'N/A';
            return `- [${date}]: User asked: "${userPreview}" / You said: "${assistantPreview}"`;
          })
          .filter((s: string) => s.length > 30);

        if (summaries.length > 0) {
          memoryPreamble = `\nPREVIOUS CONVERSATION SUMMARIES (${domain} mode):\n${summaries.join('\n')}\nUse these for continuity — reference past discussions naturally.\n`;
        }
      }
    } catch {
      // Non-critical
    }
  }

  // ── Fetch context in parallel based on pruned needs ──────────────────
  const alpacaContextPromise = needs.needsAlpaca ? getAlpacaContext() : Promise.resolve('');
  const supabaseContextPromise = needs.needsSupabase ? getSupabaseContext() : Promise.resolve('');
  const trackRecordPromise = needs.needsTrackRecord ? getTrackRecord(supabase) : Promise.resolve('');
  const conversationMemoryPromise = needs.needsConversationMemory ? getConversationMemory(supabase, mentionedSymbols) : Promise.resolve('');
  const calibrationPromise = needs.needsCalibration ? getCalibrationContext(supabase) : Promise.resolve('');
  const contrarianPromise = needs.needsContrarianRadar ? getContrarianContext(mentionedSymbols) : Promise.resolve('');

  const [alpacaContext, supabaseContext] = await Promise.all([
    alpacaContextPromise,
    supabaseContextPromise,
  ]);

  // Parse portfolio symbols from alpaca context for market intel
  const symbolMatches = alpacaContext.match(/- (\w+): \d+ shares/g) || [];
  const portfolioSymbols = symbolMatches.map(m => m.split(':')[0].replace('- ', '').trim());

  const marketContextPromise = needs.needsMarketIntel ? buildMarketContext(portfolioSymbols) : Promise.resolve('');

  // Fetch v3 intelligence + portfolio account for personality
  const baseUrl = getBaseUrl();
  const fetchPromises: Promise<Response | null>[] = [];

  const gexPromise = needs.needsGex
    ? fetch(`${baseUrl}/api/gex?symbol=SPY`).catch(() => null)
    : Promise.resolve(null);
  const macroPromise = needs.needsMacro
    ? fetch(`${baseUrl}/api/macro`).catch(() => null)
    : Promise.resolve(null);
  const driftPromise = needs.needsDrift
    ? fetch(`${baseUrl}/api/drift`).catch(() => null)
    : Promise.resolve(null);
  const accountPromise = needs.needsPersonality
    ? fetch(`${process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
        },
      }).catch(() => null)
    : Promise.resolve(null);

  const [gexRes, macroRes, driftRes, accountRes] = await Promise.all([
    gexPromise, macroPromise, driftPromise, accountPromise,
  ]);

  let gexContext = '';
  let gexRegime: string | null = null;
  let macroContext = '';
  let driftContext = '';

  if (gexRes && 'ok' in gexRes && gexRes.ok) {
    const gex = await gexRes.json();
    gexRegime = gex.regime;
    gexContext = `\nGEX INTELLIGENCE:\n  - SPY GEX Regime: ${gex.regime}\n  - Net GEX: ${gex.netGEX}\n  - Put Wall: ${gex.levels?.putWall} | Call Wall: ${gex.levels?.callWall}\n  - Gamma Flip: ${gex.levels?.gammaFlip}\n  - Impact: ${gex.impact}\n`;
  }

  if (macroRes && 'ok' in macroRes && macroRes.ok) {
    const macro = await macroRes.json();
    macroContext = `\nMACRO REGIME:\n  - Current Regime: ${macro.regime?.regime} (${(macro.regime?.confidence * 100).toFixed(0)}% confidence)\n  - Fed Prediction: ${macro.fedPrediction?.prediction} (confidence: ${(macro.fedPrediction?.confidence * 100).toFixed(0)}%)\n  - Allocation: Equities ${macro.allocation?.equities}%, Bonds ${macro.allocation?.bonds}%, Cash ${macro.allocation?.cash}%\n  - Interpretation: ${macro.interpretation}\n`;
  }

  if (driftRes && 'ok' in driftRes && driftRes.ok) {
    const drift = await driftRes.json();
    const topDrifts = (drift.scans || []).slice(0, 5);
    driftContext = `\nDRIFT REGIMES:\n${topDrifts.map((d: any) => `  - ${d.symbol}: ${d.regime} (Hurst: ${d.hurstExponent?.toFixed(3)}, Confidence: ${(d.confidence * 100).toFixed(0)}%)`).join('\n')}\n`;
  }

  // ── Await remaining parallel context ────────────────────────────────
  const behavioralPromise = needs.needsBehavioral
    ? getBehavioralAlerts(supabase, userMessage, gexRegime)
    : Promise.resolve('');
  const personalityPromise = needs.needsPersonality
    ? getPersonalityMode(supabase, accountRes && 'ok' in accountRes && accountRes.ok ? await accountRes.clone().json().catch(() => null) : null)
    : Promise.resolve('');

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
    behavioralPromise,
    personalityPromise,
  ]);

  // ── Build enriched portfolio context ────────────────────────────────
  const contextParts: string[] = [];

  if (alpacaContext) {
    contextParts.push(`\nALPACA BROKERAGE (LIVE):\n${alpacaContext}`);
  }
  if (marketContext) {
    contextParts.push(`\nMARKET INTELLIGENCE (LIVE):\n${marketContext}`);
  }
  if (gexContext) contextParts.push(gexContext);
  if (macroContext) contextParts.push(macroContext);
  if (driftContext) contextParts.push(driftContext);
  if (supabaseContext) {
    contextParts.push(`\nGLASTONBURY TERMINAL DATABASE:\n${supabaseContext}`);
  }

  contextParts.push(`\nSTATIC HOLDINGS (not in brokerage):\n  - CR3 American Exteriors equity: ~$720,000 (23 territories)\n  - Anthropic RSUs: 5,749 shares @ $259.14 grant (quarterly vesting, 4 years)\n  - Miami Shores property: ~$580,000`);

  if (trackRecord) contextParts.push(trackRecord);
  if (conversationMemory) contextParts.push(conversationMemory);
  if (calibration) contextParts.push(calibration);
  if (contrarian) contextParts.push(contrarian);
  if (behavioralAlerts) contextParts.push(behavioralAlerts);
  if (personalityMode) contextParts.push(personalityMode);
  if (memoryPreamble) contextParts.push(memoryPreamble);

  // ── Memory Pins Auto-Load ────────────────────────────────────────────
  try {
    const pinSymbols = extractSymbols(userMessage);
    const domainCategory = domain || null;

    // Build query: matching symbols OR matching domain category OR most recent general pins
    let allPins: any[] = [];

    // Fetch pins matching mentioned symbols
    if (pinSymbols.length > 0) {
      const { data: symbolPins } = await supabase
        .from('keisha_memory_pins')
        .select('content, category, symbol, created_at')
        .eq('active', true)
        .in('symbol', pinSymbols)
        .order('created_at', { ascending: false })
        .limit(10);
      if (symbolPins) allPins.push(...symbolPins);
    }

    // Fetch pins matching the current domain category
    if (domainCategory) {
      const { data: domainPins } = await supabase
        .from('keisha_memory_pins')
        .select('content, category, symbol, created_at')
        .eq('active', true)
        .eq('category', domainCategory)
        .order('created_at', { ascending: false })
        .limit(5);
      if (domainPins) allPins.push(...domainPins);
    }

    // Fetch most recent general pins (no symbol filter)
    const { data: recentPins } = await supabase
      .from('keisha_memory_pins')
      .select('content, category, symbol, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(5);
    if (recentPins) allPins.push(...recentPins);

    // Deduplicate by content and limit to 10
    const seenContent = new Set<string>();
    const uniquePins: any[] = [];
    for (const pin of allPins) {
      if (!seenContent.has(pin.content) && uniquePins.length < 10) {
        seenContent.add(pin.content);
        uniquePins.push(pin);
      }
    }

    if (uniquePins.length > 0) {
      const formattedPins = uniquePins.map((pin: any) => {
        const date = new Date(pin.created_at).toISOString().split('T')[0];
        const cat = pin.category ? `(${pin.category})` : '(general)';
        return `- [${date}] ${cat} ${pin.content}`;
      }).join('\n');

      contextParts.push(`\nMEMORY PINS (Wes's saved notes):\n${formattedPins}`);
    }
  } catch {
    // Non-critical — memory pins are supplemental context
  }

  const portfolioContext = contextParts.join('\n');

  return { portfolioContext, gexRegime, mentionedSymbols, supabase };
}
