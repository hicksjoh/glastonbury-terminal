import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { GreeksCalcCardData } from '@/types/keisha';

const inputSchema = z.object({
  ticker: z.string().describe('Underlying ticker'),
  strike: z.number().describe('Strike price'),
  expiry: z.string().describe('Expiration ISO date (YYYY-MM-DD)'),
  type: z.enum(['call', 'put']).describe('call or put'),
  iv: z.number().optional().describe('Implied vol as decimal (e.g. 0.35 for 35%). Optional; defaults to 0.3.'),
});

export const greeksCalculator: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'greeks_calculator',
  description: 'Return a live Greeks widget (Δ Γ Θ ν ρ) for a specific option contract. Computes Black-Scholes Greeks using a current-spot + implied-vol estimate. Use when Wes is evaluating an option trade and wants to see the Greeks inline.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'greeks_calculator',
    description: 'Return a live Greeks widget (Δ Γ Θ ν ρ) for a specific option contract. Computes Black-Scholes Greeks using a current-spot + implied-vol estimate. Use when Wes is evaluating an option trade and wants to see the Greeks inline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Underlying ticker' },
        strike: { type: 'number', description: 'Strike price' },
        expiry: { type: 'string', description: 'Expiration ISO date (YYYY-MM-DD)' },
        type: { type: 'string', enum: ['call', 'put'], description: 'call or put' },
        iv: { type: 'number', description: 'Implied vol as decimal (e.g. 0.35 for 35%). Optional; defaults to 0.3.' },
      },
      required: ['ticker', 'strike', 'expiry', 'type'],
    },
  }),
  async execute(input) {
    const { bsPrice, bsDelta, bsGamma, bsTheta, bsVega, bsRho } = await import('@/lib/black-scholes');
    const { fetchQuote } = await import('@/lib/crew-data');
    const sym = sanitizeSymbol(String(input.ticker ?? ''));
    const strike = Number(input.strike);
    const type = input.type === 'put' ? 'put' : 'call';
    const iv = Number(input.iv) > 0 ? Number(input.iv) : 0.30;
    const expiry = String(input.expiry ?? '');
    if (!sym || !strike || !expiry) return { result: { error: 'Need ticker, strike, expiry' }, success: false };
    const q = await fetchQuote(sym);
    if (!q) return { result: { error: 'No quote available' }, success: false };
    const spot = q.price;
    const dte = Math.max(1, Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const T = dte / 365;
    const r = 0.045; // treasury-ish
    const premium = bsPrice(spot, strike, T, r, iv, type);
    return {
      result: {
        ticker: sym, strike, expiry, type, spot, iv, dte,
        greeks: {
          delta: bsDelta(spot, strike, T, r, iv, type),
          gamma: bsGamma(spot, strike, T, r, iv),
          theta: bsTheta(spot, strike, T, r, iv, type),
          vega: bsVega(spot, strike, T, r, iv),
          rho: bsRho(spot, strike, T, r, iv, type),
        },
        premium_theoretical: premium,
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    return { type: 'greeks_calc', data: r as unknown as GreeksCalcCardData };
  },
};
