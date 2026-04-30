import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { TradePreviewCardData } from '@/types/keisha';

const legSchema = z.object({
  action: z.enum(['buy', 'sell']),
  type: z.enum(['call', 'put', 'stock']),
  strike: z.number().optional(),
  expiry: z.string().optional(),
  qty: z.number(),
  price: z.number(),
});

const inputSchema = z.object({
  ticker: z.string().describe('Underlying ticker'),
  legs: z.array(legSchema).describe('Up to 4 legs'),
});

export const tradePreview: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'trade_preview',
  description: 'Return a multi-leg trade preview widget with a P&L-at-expiry diagram. Takes an array of legs (up to 4) and computes net debit/credit, max profit, max loss, and breakevens. Use for spreads, iron condors, butterflies, straddles, etc.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'trade_preview',
    description: 'Return a multi-leg trade preview widget with a P&L-at-expiry diagram. Takes an array of legs (up to 4) and computes net debit/credit, max profit, max loss, and breakevens. Use for spreads, iron condors, butterflies, straddles, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Underlying ticker' },
        legs: {
          type: 'array',
          description: 'Up to 4 legs',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['buy', 'sell'] },
              type: { type: 'string', enum: ['call', 'put', 'stock'] },
              strike: { type: 'number' },
              expiry: { type: 'string' },
              qty: { type: 'number' },
              price: { type: 'number' },
            },
            required: ['action', 'type', 'qty', 'price'],
          },
        },
      },
      required: ['ticker', 'legs'],
    },
  }),
  async execute(input) {
    const sym = sanitizeSymbol(String(input.ticker ?? ''));
    const legsRaw = Array.isArray(input.legs) ? input.legs : [];
    if (!sym || legsRaw.length === 0) return { result: { error: 'Need ticker + legs' }, success: false };
    type Leg = { action: 'buy'|'sell'; type: 'call'|'put'|'stock'; strike?: number; expiry?: string; qty: number; price: number };
    const legs: Leg[] = legsRaw.slice(0, 4).map(l => {
      const o = l as Record<string, unknown>;
      return {
        action: o.action === 'sell' ? 'sell' : 'buy',
        type: o.type === 'put' ? 'put' : o.type === 'stock' ? 'stock' : 'call',
        strike: o.strike ? Number(o.strike) : undefined,
        expiry: o.expiry ? String(o.expiry) : undefined,
        qty: Math.max(1, Number(o.qty) || 1),
        price: Number(o.price) || 0,
      };
    });

    const netDebitCredit = legs.reduce((sum, l) => {
      const mult = l.type === 'stock' ? 1 : 100;
      const sign = l.action === 'buy' ? 1 : -1;
      return sum + sign * l.price * l.qty * mult;
    }, 0);

    // Payoff-at-expiry curve across +/- 20% of highest strike (or spot)
    const strikes = legs.map(l => l.strike).filter((s): s is number => typeof s === 'number');
    const centerGuess = strikes.length ? strikes.reduce((a,b)=>a+b,0)/strikes.length : 100;
    const low = centerGuess * 0.7;
    const high = centerGuess * 1.3;
    const STEPS = 60;
    const curve: { price: number; pnl: number }[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const price = low + (high - low) * (i / STEPS);
      let pnl = -netDebitCredit;
      for (const l of legs) {
        const mult = l.type === 'stock' ? 1 : 100;
        const sign = l.action === 'buy' ? 1 : -1;
        if (l.type === 'stock') {
          pnl += sign * (price - l.price) * l.qty;
        } else {
          const intrinsic = l.type === 'call'
            ? Math.max(0, price - (l.strike ?? 0))
            : Math.max(0, (l.strike ?? 0) - price);
          pnl += sign * intrinsic * l.qty * mult;
        }
      }
      curve.push({ price: Number(price.toFixed(2)), pnl: Number(pnl.toFixed(2)) });
    }

    const maxProfit = Math.max(...curve.map(p => p.pnl));
    const maxLoss = Math.min(...curve.map(p => p.pnl));
    // Breakevens = prices where pnl crosses zero
    const breakevens: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i-1], b = curve[i];
      if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl > 0 && b.pnl <= 0)) {
        const t = a.pnl / (a.pnl - b.pnl);
        breakevens.push(Number((a.price + t * (b.price - a.price)).toFixed(2)));
      }
    }

    return {
      result: {
        ticker: sym,
        legs,
        net_debit_credit: netDebitCredit,
        max_profit: isFinite(maxProfit) ? Number(maxProfit.toFixed(2)) : null,
        max_loss: isFinite(maxLoss) ? Number(maxLoss.toFixed(2)) : null,
        breakevens,
        payoff_curve: curve,
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    return { type: 'trade_preview', data: r as unknown as TradePreviewCardData };
  },
};
