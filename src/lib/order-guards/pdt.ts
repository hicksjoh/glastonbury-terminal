// F12 — Pattern Day Trader (PDT) guard.
//
// FINRA Rule 4210: an account is flagged PDT if it executes 4+ day trades
// (round-trip same-symbol same-session) in any rolling 5-business-day
// window AND the day trades represent more than 6% of total trades.
// If flagged AND equity is below $25K, the broker must restrict the
// account to closing-only positions for 90 days.
//
// We don't actually want Wes flagged. This guard's job is to count today's
// day-trade tally + simulate whether the proposed order would push him to
// 4 in the rolling window.

import { alpacaFetch } from '@/lib/alpaca';

export interface PdtCheckResult {
  /** Total day trades counted in the rolling 5-business-day window. */
  dayTradesInWindow: number;
  /** Account equity in USD, used to gate the under-$25K rule. */
  equityUsd: number;
  /** Would the proposed order itself create a same-day round-trip? */
  wouldBeDayTrade: boolean;
  /** PDT verdict for this proposed order. */
  verdict: 'ok' | 'caution' | 'block';
  reasons: string[];
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  filled_at: string | null;
  filled_qty: string | null;
}

interface AlpacaAccount {
  equity?: string;
  pattern_day_trader?: boolean;
  daytrade_count?: number | string;
}

const FIVE_BUSINESS_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 5 business days ≈ 7 cal days

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Count round-trip day trades from Alpaca's recent filled orders. A round
 * trip = same symbol with at least one buy and one sell filled the same
 * trading day. Returns the count over the last ~5 business days.
 */
async function countRecentDayTrades(): Promise<number> {
  try {
    const since = new Date(Date.now() - FIVE_BUSINESS_DAYS_MS).toISOString();
    const orders = await alpacaFetch(
      `/v2/orders?status=filled&until=&after=${encodeURIComponent(since)}&direction=desc&limit=200`,
    );
    const filled = (orders as AlpacaOrder[] | null) ?? [];

    // Group filled orders by (symbol, day).
    const buckets = new Map<string, { buys: number; sells: number }>();
    for (const o of filled) {
      if (!o.filled_at || o.status !== 'filled') continue;
      const day = new Date(o.filled_at);
      const key = `${o.symbol}|${day.toISOString().slice(0, 10)}`;
      const cur = buckets.get(key) ?? { buys: 0, sells: 0 };
      if (o.side === 'buy') cur.buys += 1;
      else if (o.side === 'sell') cur.sells += 1;
      buckets.set(key, cur);
    }

    let count = 0;
    Array.from(buckets.values()).forEach((v) => {
      if (v.buys > 0 && v.sells > 0) count += 1;
    });
    return count;
  } catch {
    return 0;
  }
}

async function getAccountSnapshot(): Promise<{ equityUsd: number; isPdtFlagged: boolean; alpacaDaytradeCount: number }> {
  try {
    const acct = await alpacaFetch('/v2/account');
    const a = acct as AlpacaAccount;
    return {
      equityUsd: a.equity ? Number(a.equity) : 0,
      isPdtFlagged: !!a.pattern_day_trader,
      alpacaDaytradeCount: typeof a.daytrade_count === 'string'
        ? Number(a.daytrade_count)
        : Number(a.daytrade_count ?? 0),
    };
  } catch {
    return { equityUsd: 0, isPdtFlagged: false, alpacaDaytradeCount: 0 };
  }
}

/**
 * Would the proposed order itself create a same-day round-trip? We answer
 * "yes" when there's already a fill in the opposite direction for this
 * symbol earlier today.
 */
async function wouldBeDayTrade(symbol: string, side: 'buy' | 'sell'): Promise<boolean> {
  try {
    const today = new Date();
    const startOfDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    ).toISOString();
    const orders = await alpacaFetch(
      `/v2/orders?status=filled&after=${encodeURIComponent(startOfDay)}&direction=desc&limit=100`,
    );
    const filled = ((orders as AlpacaOrder[] | null) ?? []).filter(
      (o) => o.symbol === symbol && o.filled_at && isSameDay(new Date(o.filled_at), today),
    );
    const opposite = side === 'buy' ? 'sell' : 'buy';
    return filled.some((o) => o.side === opposite);
  } catch {
    return false;
  }
}

export async function checkPdt(
  symbol: string,
  side: 'buy' | 'sell',
): Promise<PdtCheckResult> {
  const [{ equityUsd, isPdtFlagged, alpacaDaytradeCount }, dayTradesInWindow, mightBeDayTrade] = await Promise.all([
    getAccountSnapshot(),
    countRecentDayTrades(),
    wouldBeDayTrade(symbol, side),
  ]);

  // Use whichever counter is higher — Alpaca's own daytrade_count or our
  // rolling-window scan. They should agree, but Alpaca's is authoritative.
  const effectiveCount = Math.max(dayTradesInWindow, alpacaDaytradeCount);

  const reasons: string[] = [];
  let verdict: 'ok' | 'caution' | 'block' = 'ok';

  if (isPdtFlagged && equityUsd < 25_000) {
    verdict = 'block';
    reasons.push(
      `Account is FLAGGED PDT and equity ($${equityUsd.toLocaleString()}) is below the $25K minimum — broker will reject the order.`,
    );
  } else if (mightBeDayTrade && equityUsd < 25_000 && effectiveCount + 1 >= 4) {
    verdict = 'block';
    reasons.push(
      `This trade would be your 4th day trade in 5 business days while equity ($${equityUsd.toLocaleString()}) is below $25K. Submitting it triggers PDT lockout.`,
    );
  } else if (mightBeDayTrade && effectiveCount + 1 >= 3) {
    verdict = 'caution';
    reasons.push(
      `This is day trade ${effectiveCount + 1} in the rolling 5-day window. One more and the PDT designation kicks in.`,
    );
  } else if (mightBeDayTrade) {
    verdict = 'caution';
    reasons.push('This trade closes a same-session round trip — counts as a day trade.');
  }

  return {
    dayTradesInWindow: effectiveCount,
    equityUsd,
    wouldBeDayTrade: mightBeDayTrade,
    verdict,
    reasons,
  };
}
