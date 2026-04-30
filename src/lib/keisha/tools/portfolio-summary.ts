import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import type { PortfolioCardData } from '@/types/keisha';

const inputSchema = z.object({});

export const portfolioSummary: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'portfolio_summary',
  description: 'Get a full portfolio summary -- equity, cash, buying power, position count, total market value, and total unrealized P&L.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
    name: 'portfolio_summary',
    description: 'Get a full portfolio summary -- equity, cash, buying power, position count, total market value, and total unrealized P&L.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  }),
  async execute(_input) {
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    const headers = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
    };

    const [accountRes, positionsRes] = await Promise.all([
      fetch(`${baseUrl}/v2/account`, { headers }),
      fetch(`${baseUrl}/v2/positions`, { headers }),
    ]);

    const account = accountRes.ok ? await accountRes.json() : null;
    const positions = positionsRes.ok ? await positionsRes.json() : [];

    return {
      result: {
        equity: account ? parseFloat(account.equity) : null,
        cash: account ? parseFloat(account.cash) : null,
        buyingPower: account ? parseFloat(account.buying_power) : null,
        positionCount: positions.length,
        totalMarketValue: positions.reduce((s: number, p: { market_value?: string }) => s + parseFloat(p.market_value || '0'), 0),
        totalUnrealizedPl: positions.reduce((s: number, p: { unrealized_pl?: string }) => s + parseFloat(p.unrealized_pl || '0'), 0),
      },
      success: true,
    };
  },
  buildRenderCard(_input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!r.equity) return null;
    const equity = Number(r.equity);
    const unrealizedPl = Number(r.totalUnrealizedPl || 0);
    return {
      type: 'portfolio',
      data: {
        totalValue: equity,
        dailyPnl: unrealizedPl,
        dailyPnlPct: equity > 0 ? +((unrealizedPl / equity) * 100).toFixed(2) : 0,
        topPositions: [],
        allocation: [],
      } as PortfolioCardData,
    };
  },
};
