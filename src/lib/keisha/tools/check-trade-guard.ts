import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import { runTradeGuard } from '@/lib/trade-guard-engine';
import type { GuardCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  side: z.enum(['buy', 'sell']).describe('Trade direction'),
  quantity: z.number().describe('Number of shares proposed'),
  price: z.number().optional().describe('Current or target price per share (0 to auto-fetch)'),
});

export const checkTradeGuard: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'check_trade_guard',
  description: 'Run the Behavioral Trading Guardian before any trade. Checks for behavioral biases (panic selling, performance chasing, disposition effect), calculates Kelly criterion position sizing, detects market regime, and flags concentration risk. ALWAYS call this BEFORE place_order when Wes discusses buying or selling.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'check_trade_guard',
    description: 'Run the Behavioral Trading Guardian before any trade. Checks for behavioral biases (panic selling, performance chasing, disposition effect), calculates Kelly criterion position sizing, detects market regime, and flags concentration risk. ALWAYS call this BEFORE place_order when Wes discusses buying or selling.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Trade direction' },
        quantity: { type: 'number', description: 'Number of shares proposed' },
        price: { type: 'number', description: 'Current or target price per share (0 to auto-fetch)' },
      },
      required: ['symbol', 'side', 'quantity'],
    },
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const side = String(input.side || 'buy') as 'buy' | 'sell';
    const quantity = Number(input.quantity) || 10;
    let price = Number(input.price) || 0;

    // Auto-fetch price if not provided
    if (price === 0) {
      try {
        const snapRes = await fetch(
          `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot`,
          {
            headers: {
              'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
              'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
            },
          },
        );
        if (snapRes.ok) {
          const snap = await snapRes.json();
          price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
        }
      } catch { /* proceed with 0 */ }
    }

    if (price === 0) {
      return { result: { error: `Could not determine price for ${symbol}` }, success: false };
    }

    const guardResult = await runTradeGuard({ symbol, side, quantity, price });
    return { result: guardResult, success: true };
  },
  buildRenderCard(input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.verdict) return null;
    return {
      type: 'guard',
      data: {
        verdict: String(r.verdict) as 'CLEAR' | 'CAUTION' | 'STOP',
        verdictMessage: String(r.verdictMessage || ''),
        symbol: String((r as Record<string, unknown>).symbol || input.symbol || ''),
        side: String(input.side || 'buy') as 'buy' | 'sell',
        behavioralAlerts: ((r.behavioral as Record<string, unknown>)?.alerts as Array<Record<string, unknown>> || []).map(a => ({
          type: String(a.type || ''),
          severity: String(a.severity || 'warning'),
          title: String(a.title || ''),
          message: String(a.message || ''),
          recommendation: String(a.recommendation || ''),
        })),
        kellySizing: {
          proposedShares: Number((r.sizing as Record<string, unknown>)?.proposedShares || 0),
          proposedPct: String((r.sizing as Record<string, unknown>)?.proposedPct || '0'),
          halfKellyShares: Number(((r.sizing as Record<string, unknown>)?.kelly as Record<string, unknown>)?.halfKellyShares || 0),
          halfKellyPct: String(((r.sizing as Record<string, unknown>)?.kelly as Record<string, unknown>)?.halfKellyPct || '0'),
          regimeAdjustedShares: Number(((r.sizing as Record<string, unknown>)?.kelly as Record<string, unknown>)?.regimeAdjustedShares || 0),
          verdict: String((r.sizing as Record<string, unknown>)?.verdict || ''),
          verdictMessage: String((r.sizing as Record<string, unknown>)?.verdictMessage || ''),
        },
        regime: {
          label: String((r.regime as Record<string, unknown>)?.label || ''),
          advice: String((r.regime as Record<string, unknown>)?.advice || ''),
          regimeMultiplier: Number((r.regime as Record<string, unknown>)?.regimeMultiplier || 1),
        },
        concentration: r.concentration ? {
          concentrationPct: String((r.concentration as Record<string, unknown>).concentrationPct || '0'),
          warning: (r.concentration as Record<string, unknown>).warning as string | null,
        } : undefined,
      } as GuardCardData,
    };
  },
};
