import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  classifyHoldingPeriod,
  calculateCapitalGainsTax,
  calculateIncomeTax,
  TAX_DISCLAIMER,
  type FilingStatus,
} from '@/lib/tax-engine';
import { getWashSalePreview, type TradeRecord } from '@/lib/wash-sale-detector';
import { compareLotMethods, type TaxLot } from '@/lib/tax-lot-optimizer';

// ═══════════════════════════════════════════════════════════════════════════
//  Tax Impact API — Pre-trade tax analysis in a single call
//  GET /api/tax/impact?symbol=AAPL&side=sell&qty=10
// ═══════════════════════════════════════════════════════════════════════════

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
};

interface AlpacaActivity {
  id: string;
  activity_type: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  transaction_time: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  current_price: string;
}

async function fetchTradeHistory(symbol: string): Promise<TradeRecord[]> {
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 2);
    const sinceStr = since.toISOString().split('T')[0];
    const res = await fetch(
      `${ALPACA_BASE}/v2/account/activities/FILL?after=${sinceStr}T00:00:00Z&direction=desc&page_size=500`,
      { headers: ALPACA_HEADERS, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const raw: AlpacaActivity[] = await res.json();
    return raw
      .filter(a => a.activity_type === 'FILL' && a.symbol === symbol)
      .map(a => ({
        id: a.id,
        ticker: a.symbol,
        action: a.side === 'buy' ? 'buy' as const : 'sell' as const,
        quantity: parseFloat(a.qty),
        price: parseFloat(a.price),
        date: a.transaction_time.split('T')[0],
      }));
  } catch {
    return [];
  }
}

async function fetchPosition(symbol: string): Promise<AlpacaPosition | null> {
  try {
    const res = await fetch(`${ALPACA_BASE}/v2/positions/${symbol}`, {
      headers: ALPACA_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = rateLimit('tax-impact', 30, 60000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  const side = url.searchParams.get('side') || 'sell';
  const qty = parseFloat(url.searchParams.get('qty') || '0');
  const filingStatus = (url.searchParams.get('filing_status') || 'single') as FilingStatus;
  const ordinaryIncome = parseFloat(url.searchParams.get('ordinary_income') || '100000');

  if (!symbol) {
    return NextResponse.json({ success: false, error: 'symbol is required' }, { status: 400 });
  }

  try {
    // Fetch position and trade history in parallel
    const [position, trades] = await Promise.all([
      fetchPosition(symbol),
      fetchTradeHistory(symbol),
    ]);

    const currentPrice = position ? parseFloat(position.current_price) : 0;
    const avgEntry = position ? parseFloat(position.avg_entry_price) : 0;
    const positionQty = position ? Math.abs(parseFloat(position.qty)) : 0;
    const sellQty = qty > 0 ? qty : positionQty;

    // ── Holding Period ────────────────────────────────────────────────
    const buyTrades = trades.filter(t => t.action === 'buy').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const earliestBuyDate = buyTrades.length > 0 ? buyTrades[0].date : null;

    let holdingPeriod: { type: string; daysHeld: number; daysUntilLongTerm: number } | null = null;
    if (earliestBuyDate) {
      holdingPeriod = classifyHoldingPeriod(earliestBuyDate, new Date());
    }

    // ── Estimated Gain/Loss ──────────────────────────────────────────
    const estimatedGain = position
      ? (currentPrice - avgEntry) * sellQty
      : 0;

    // ── Tax Estimate ─────────────────────────────────────────────────
    let estimatedTax = 0;
    let taxRate = 0;
    const isLongTerm = holdingPeriod?.type === 'long_term';

    if (estimatedGain > 0) {
      if (isLongTerm) {
        const capResult = calculateCapitalGainsTax(estimatedGain, ordinaryIncome, filingStatus);
        estimatedTax = capResult.tax;
        taxRate = capResult.effectiveRate;
      } else {
        // Short-term = ordinary income rates
        const incomeTaxWithGain = calculateIncomeTax(ordinaryIncome + estimatedGain, filingStatus);
        const incomeTaxWithout = calculateIncomeTax(ordinaryIncome, filingStatus);
        estimatedTax = Math.round((incomeTaxWithGain.totalTax - incomeTaxWithout.totalTax) * 100) / 100;
        taxRate = incomeTaxWithGain.marginalRate;
      }
    }

    // ── Long-term savings nudge ──────────────────────────────────────
    let longTermSavings = 0;
    const daysUntilLT = holdingPeriod?.daysUntilLongTerm ?? 0;
    const isNearLongTerm = !isLongTerm && daysUntilLT > 0 && daysUntilLT <= 60;

    if (isNearLongTerm && estimatedGain > 0) {
      const stTax = estimatedTax; // what you'd pay now at ST rates
      const ltResult = calculateCapitalGainsTax(estimatedGain, ordinaryIncome, filingStatus);
      longTermSavings = Math.round((stTax - ltResult.tax) * 100) / 100;
    }

    // ── Wash Sale Preview ────────────────────────────────────────────
    const washSaleAlert = getWashSalePreview(
      symbol,
      side as 'buy' | 'sell',
      trades,
      currentPrice,
    );

    // ── Lot Comparison (sell only, if multiple buys exist) ───────────
    let lotComparison = null;
    if (side === 'sell' && buyTrades.length > 1 && sellQty > 0) {
      const taxLots: TaxLot[] = buyTrades.map((t, i) => ({
        id: t.id || `lot-${i}`,
        ticker: symbol,
        buyDate: new Date(t.date),
        quantity: t.quantity,
        costBasis: t.price,
        currentPrice,
      }));

      try {
        lotComparison = compareLotMethods(taxLots, sellQty, {
          marginalRate: taxRate || 0.24,
          ordinaryIncome,
          filingStatus,
          sellDate: new Date(),
        });
      } catch {
        // Not enough lots or other issue
        lotComparison = null;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        side,
        qty: sellQty,
        currentPrice,
        avgEntry,
        estimatedGain: Math.round(estimatedGain * 100) / 100,
        holdingPeriod: holdingPeriod
          ? {
              type: holdingPeriod.type,
              daysHeld: holdingPeriod.daysHeld,
              daysUntilLongTerm: holdingPeriod.daysUntilLongTerm,
            }
          : null,
        taxEstimate: {
          tax: estimatedTax,
          rate: taxRate,
          isLongTerm,
        },
        longTermNudge: isNearLongTerm
          ? {
              daysToWait: daysUntilLT,
              potentialSavings: longTermSavings,
            }
          : null,
        washSale: washSaleAlert
          ? {
              triggered: washSaleAlert.severity === 'critical' || washSaleAlert.severity === 'warning',
              severity: washSaleAlert.severity,
              message: washSaleAlert.message,
              conflictingTrade: washSaleAlert.details.conflictingTrade || null,
              disallowedLoss: washSaleAlert.details.disallowedLoss,
            }
          : null,
        lotComparison: lotComparison
          ? {
              bestMethod: lotComparison.bestMethod,
              maxSavings: lotComparison.maxSavings,
              methods: Object.fromEntries(
                Object.entries(lotComparison.methods).map(([method, result]) => [
                  method,
                  {
                    totalGainLoss: result.totalGainLoss,
                    totalTaxEstimate: result.totalTaxEstimate,
                    shortTermGains: result.shortTermGains,
                    longTermGains: result.longTermGains,
                  },
                ]),
              ),
            }
          : null,
        disclaimer: TAX_DISCLAIMER,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tax impact calculation failed';
    console.error('[tax/impact] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
