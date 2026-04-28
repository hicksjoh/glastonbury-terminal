// F12 — Pre-trade order-guard runner.
//
// Every order POSTed through /api/alpaca/orders flows through this module
// first. We compute two things:
//   1. PDT status (would this order trigger pattern-day-trader lockout?)
//   2. Wash-sale risk (would this sale be a §1091 wash sale?)
//
// Verdict precedence: any "block" wins. If everything is "ok" the order
// goes through. "caution" surfaces warnings but still allows the trade.
//
// Callers can pass `mode: 'preview'` to compute the verdict WITHOUT
// actually submitting an order — useful for the order-ticket UI to show
// warnings before Wes hits the buy/sell button.

import { alpacaFetch } from '@/lib/alpaca';
import { checkPdt, type PdtCheckResult } from './pdt';
import { checkWashSale, type TradeRecord } from '@/lib/wash-sale-detector';

export interface OrderGuardInput {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  /** Limit price or estimated market price — used for wash-sale loss math. */
  estimatedPrice?: number;
}

export interface OrderGuardVerdict {
  verdict: 'ok' | 'caution' | 'block';
  reasons: string[];
  pdt: PdtCheckResult;
  washSale: {
    isWashSale: boolean;
    reason?: string;
    disallowedLoss?: number;
  };
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
}

interface AlpacaOrderRow {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  filled_at: string | null;
  filled_avg_price: string | null;
  filled_qty: string | null;
}

/**
 * Pull this user's last 90 days of Alpaca fills + current positions to
 * give the wash-sale detector the trade history it needs.
 */
async function loadTradeHistory(symbol: string): Promise<TradeRecord[]> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const orders = await alpacaFetch(
      `/v2/orders?status=filled&after=${encodeURIComponent(ninetyDaysAgo)}&direction=desc&limit=500`,
    );
    const rows = ((orders as AlpacaOrderRow[] | null) ?? []).filter(
      (o) => o.symbol === symbol && o.filled_at && o.status === 'filled',
    );
    return rows.map((o) => ({
      id: o.id,
      ticker: o.symbol,
      action: o.side,
      quantity: Number(o.filled_qty ?? 0),
      price: Number(o.filled_avg_price ?? 0),
      date: (o.filled_at ?? '').slice(0, 10),
    }));
  } catch {
    return [];
  }
}

async function findCurrentCostBasis(symbol: string): Promise<number | null> {
  try {
    const positions = await alpacaFetch('/v2/positions');
    const list = ((positions as AlpacaPosition[] | null) ?? []).filter(p => p.symbol === symbol);
    if (list.length === 0) return null;
    return Number(list[0].avg_entry_price);
  } catch {
    return null;
  }
}

export async function runOrderGuards(input: OrderGuardInput): Promise<OrderGuardVerdict> {
  const symbol = input.symbol.toUpperCase();
  const reasons: string[] = [];

  // ─── PDT (always checked) ──────────────────────────────────────────
  const pdt = await checkPdt(symbol, input.side);
  if (pdt.reasons.length > 0) reasons.push(...pdt.reasons);

  // ─── Wash sale (only checked on SELL orders) ───────────────────────
  let washSale: OrderGuardVerdict['washSale'] = { isWashSale: false };
  if (input.side === 'sell' && input.estimatedPrice && input.estimatedPrice > 0) {
    const [history, costBasis] = await Promise.all([
      loadTradeHistory(symbol),
      findCurrentCostBasis(symbol),
    ]);

    if (costBasis !== null && input.estimatedPrice < costBasis) {
      const realizedLoss = (costBasis - input.estimatedPrice) * input.qty;
      const result = checkWashSale(
        {
          ticker: symbol,
          sellDate: new Date(),
          sellPrice: input.estimatedPrice,
          sellQuantity: input.qty,
          realizedLoss,
          costBasis,
        },
        history,
      );
      if (result.isWashSale) {
        washSale = {
          isWashSale: true,
          reason: result.reason,
          disallowedLoss: result.disallowedLoss,
        };
        reasons.push(`Wash-sale: ${result.reason}`);
      }
    }
  }

  // ─── Combine verdicts ──────────────────────────────────────────────
  let verdict: 'ok' | 'caution' | 'block' = 'ok';
  if (pdt.verdict === 'block') verdict = 'block';
  else if (washSale.isWashSale) verdict = 'caution';
  else if (pdt.verdict === 'caution') verdict = 'caution';

  return { verdict, reasons, pdt, washSale };
}
