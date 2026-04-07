import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getCached, setCache, TTL } from '@/lib/server-cache';
import {
  ACTIVE_TAX_YEAR,
  classifyHoldingPeriod,
  calculateIncomeTax,
  getTaxBracketInfo,
  type FilingStatus,
} from '@/lib/tax-engine';
import { getWashSalePreview, getUpcomingWindowCloses, type TradeRecord } from '@/lib/wash-sale-detector';

// ═══════════════════════════════════════════════════════════════════════════
//  Proactive Tax Alerts — Surface tax opportunities automatically
// ═══════════════════════════════════════════════════════════════════════════

export interface TaxAlert {
  id: string;
  type: 'harvest_opportunity' | 'holding_period_milestone' | 'wash_sale_window' |
        'quarterly_due' | 'year_end_planning' | 'bracket_proximity' | 'retirement_deadline';
  severity: 'urgent' | 'important' | 'info';
  title: string;
  message: string;
  potentialSavings?: number;
  deadline?: string;
  actionUrl?: string;
  dismissed: boolean;
}

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
};

const CACHE_KEY = 'tax-alerts';

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  market_value: string;
  cost_basis: string;
}

interface AlpacaActivity {
  id: string;
  activity_type: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  transaction_time: string;
}

async function fetchPositions(): Promise<AlpacaPosition[]> {
  try {
    const res = await fetch(`${ALPACA_BASE}/v2/positions`, {
      headers: ALPACA_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? res.json() : [];
  } catch { return []; }
}

async function fetchTradeHistory(): Promise<TradeRecord[]> {
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - 6);
    const res = await fetch(
      `${ALPACA_BASE}/v2/account/activities/FILL?after=${since.toISOString().split('T')[0]}T00:00:00Z&direction=desc&page_size=500`,
      { headers: ALPACA_HEADERS, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const raw: AlpacaActivity[] = await res.json();
    return raw.filter(a => a.activity_type === 'FILL').map(a => ({
      id: a.id,
      ticker: a.symbol,
      action: a.side === 'buy' ? 'buy' as const : 'sell' as const,
      quantity: parseFloat(a.qty),
      price: parseFloat(a.price),
      date: a.transaction_time.split('T')[0],
    }));
  } catch { return []; }
}

function makeId(type: string, key: string): string {
  return `tax-${type}-${key}`.replace(/[^a-zA-Z0-9-]/g, '');
}

export async function GET(request: Request): Promise<NextResponse> {
  const rl = rateLimit('tax-alerts', 20, 60000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  // Check cache (5 min)
  const cached = getCached<TaxAlert[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ success: true, alerts: cached, cached: true });
  }

  const url = new URL(request.url);
  const filingStatus = (url.searchParams.get('filing_status') || 'single') as FilingStatus;
  const ordinaryIncome = parseFloat(url.searchParams.get('ordinary_income') || '100000');

  try {
    const [positions, trades] = await Promise.all([fetchPositions(), fetchTradeHistory()]);
    const now = new Date();
    const month = now.getMonth() + 1;
    const alerts: TaxAlert[] = [];

    // ── 1. Harvest Opportunity ────────────────────────────────────────
    const losers = positions.filter(p => parseFloat(p.unrealized_pl) < -500);
    const ytdGains = trades
      .filter(t => t.action === 'sell' && new Date(t.date).getFullYear() === now.getFullYear())
      .reduce((sum, t) => sum + t.quantity * t.price, 0); // rough proxy

    if (losers.length > 0) {
      const totalLoss = losers.reduce((s, p) => s + Math.abs(parseFloat(p.unrealized_pl)), 0);
      alerts.push({
        id: makeId('harvest', 'losers'),
        type: 'harvest_opportunity',
        severity: ytdGains > 0 ? 'urgent' : 'important',
        title: `${losers.length} Tax-Loss Harvest Candidate${losers.length > 1 ? 's' : ''}`,
        message: `${losers.map(p => p.symbol).join(', ')} — ${fmtCurrency(totalLoss)} in unrealized losses. ${ytdGains > 0 ? 'You have YTD gains to offset.' : 'Can offset up to $3K of ordinary income.'}`,
        potentialSavings: Math.round(totalLoss * 0.24),
        actionUrl: '/tax',
        dismissed: false,
      });
    }

    // ── 2. Holding Period Milestone ───────────────────────────────────
    const buyDates = new Map<string, string>();
    for (const t of trades) {
      if (t.action === 'buy' && !buyDates.has(t.ticker)) {
        buyDates.set(t.ticker, t.date);
      }
    }
    // Check oldest buy per ticker
    for (const t of trades.filter(t => t.action === 'buy')) {
      const existing = buyDates.get(t.ticker);
      if (existing && new Date(t.date) < new Date(existing)) {
        buyDates.set(t.ticker, t.date);
      }
    }

    for (const pos of positions) {
      const buyDate = buyDates.get(pos.symbol);
      if (!buyDate) continue;
      const hp = classifyHoldingPeriod(buyDate, now);
      if (hp.type === 'short_term' && hp.daysUntilLongTerm <= 14 && hp.daysUntilLongTerm > 0) {
        alerts.push({
          id: makeId('holding', pos.symbol),
          type: 'holding_period_milestone',
          severity: 'important',
          title: `${pos.symbol} → Long-Term in ${hp.daysUntilLongTerm} Days`,
          message: `Held ${hp.daysHeld} days. Selling now = short-term rate. Waiting ${hp.daysUntilLongTerm} more days = long-term rate (lower tax).`,
          potentialSavings: Math.round(parseFloat(pos.unrealized_pl) * 0.09), // ~9% ST vs LT diff
          actionUrl: '/trading',
          dismissed: false,
        });
      }
    }

    // ── 3. Wash Sale Window Closing ──────────────────────────────────
    const windowCloses = getUpcomingWindowCloses(trades);
    for (const wc of windowCloses) {
      alerts.push({
        id: makeId('wash', `${wc.ticker}-${wc.details?.windowEnd || ''}`),
        type: 'wash_sale_window',
        severity: 'info',
        title: `Safe to Rebuy ${wc.ticker}`,
        message: wc.message,
        deadline: wc.details?.windowEnd || undefined,
        actionUrl: '/tax',
        dismissed: false,
      });
    }

    // ── 4. Quarterly Payment Due ─────────────────────────────────────
    const qDates = ACTIVE_TAX_YEAR.estimatedTaxDates;
    for (const [q, dateStr] of Object.entries(qDates)) {
      const due = new Date(dateStr);
      const daysUntil = Math.ceil((due.getTime() - now.getTime()) / 86400000);
      if (daysUntil > 0 && daysUntil <= 14) {
        alerts.push({
          id: makeId('quarterly', q),
          type: 'quarterly_due',
          severity: 'urgent',
          title: `${q.toUpperCase()} Estimated Tax Due in ${daysUntil} Days`,
          message: `Quarterly estimated tax payment is due ${dateStr}. Late payment triggers underpayment penalty.`,
          deadline: dateStr,
          actionUrl: '/tax',
          dismissed: false,
        });
      }
    }

    // ── 5. Year-End Planning ─────────────────────────────────────────
    if (month >= 10 && month <= 12) {
      alerts.push({
        id: makeId('yearend', String(now.getFullYear())),
        type: 'year_end_planning',
        severity: 'important',
        title: 'Year-End Tax Planning Window Open',
        message: 'Q4 priorities: accelerate tax losses, defer gains if possible, max retirement contributions, review estimated payments.',
        actionUrl: '/tax',
        dismissed: false,
      });
    }

    // ── 6. Bracket Proximity ─────────────────────────────────────────
    const taxableIncome = Math.max(0, ordinaryIncome - ACTIVE_TAX_YEAR.standardDeduction[filingStatus]);
    const bracketInfo = getTaxBracketInfo(taxableIncome, filingStatus);
    if (bracketInfo.roomInBracket !== Infinity && bracketInfo.roomInBracket < 10000) {
      alerts.push({
        id: makeId('bracket', String(bracketInfo.currentBracket)),
        type: 'bracket_proximity',
        severity: 'important',
        title: `${fmtCurrency(bracketInfo.roomInBracket)} Until Next Tax Bracket`,
        message: `You're in the ${(bracketInfo.currentBracket * 100).toFixed(0)}% bracket with only ${fmtCurrency(bracketInfo.roomInBracket)} of room. Next realized gain could push you into a higher bracket.`,
        actionUrl: '/tax',
        dismissed: false,
      });
    }

    // ── 7. Retirement Deadline ───────────────────────────────────────
    if (month === 12) {
      const retLimits = ACTIVE_TAX_YEAR.retirementLimits;
      alerts.push({
        id: makeId('retirement', String(now.getFullYear())),
        type: 'retirement_deadline',
        severity: 'important',
        title: 'Retirement Contribution Deadline Approaching',
        message: `401(k) contributions must be made by Dec 31 (limit: $${retLimits.k401.toLocaleString()}). IRA contributions allowed until April 15 of next year.`,
        potentialSavings: Math.round(retLimits.k401 * calculateIncomeTax(taxableIncome, filingStatus).marginalRate),
        deadline: `${now.getFullYear()}-12-31`,
        actionUrl: '/settings',
        dismissed: false,
      });
    }

    // Sort: urgent first, then important, then info
    const severityOrder: Record<string, number> = { urgent: 0, important: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    setCache(CACHE_KEY, alerts, TTL.SHORT); // 5 min
    return NextResponse.json({ success: true, alerts, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tax alert generation failed';
    console.error('[tax/alerts] Error:', msg);
    return NextResponse.json({ success: false, error: msg, alerts: [] }, { status: 500 });
  }
}

function fmtCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
