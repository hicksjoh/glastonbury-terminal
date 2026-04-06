import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// ═════════════════════════════════════════════════════════════════════════════
//  Keisha Native Tool Definitions — replaces XML tag parsing
// ═════════════════════════════════════════════════════════════════════════════

export const KEISHA_TOOLS: Tool[] = [
  {
    name: 'lookup_price',
    description: 'Look up the current price, change, volume, and key stats for a stock symbol. Use this whenever Wes asks about a stock price or you need current market data to inform your analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol (e.g., AAPL, NVDA)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_position',
    description: 'Get details on a specific position in the Alpaca brokerage account — qty, market value, cost basis, unrealized P&L, avg entry price.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'portfolio_summary',
    description: 'Get a full portfolio summary — equity, cash, buying power, position count, total market value, and total unrealized P&L.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_watchlist',
    description: 'Add a stock symbol to the watchlist. Fetches company name and current price automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol to add' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'remove_watchlist',
    description: 'Remove a stock symbol from the watchlist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol to remove' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'update_watchlist_target',
    description: 'Update buy target, sell target, or notes for a watchlist symbol.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        buyTarget: { type: 'number', description: 'Target buy price' },
        sellTarget: { type: 'number', description: 'Target sell price' },
        notes: { type: 'string', description: 'Notes about this position' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'set_alert',
    description: 'Set a price alert for a stock. Triggers when the condition is met.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        condition: {
          type: 'string',
          enum: ['price_above', 'price_below', 'pct_change'],
          description: 'Alert condition type',
        },
        value: { type: 'number', description: 'Threshold value (price in dollars or percentage)' },
      },
      required: ['symbol', 'condition', 'value'],
    },
  },
  {
    name: 'place_order',
    description: 'Place a stock order (buy or sell). IMPORTANT: This executes a real trade. Only use when Wes explicitly asks to buy or sell shares.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Buy or sell' },
        qty: { type: 'number', description: 'Number of shares' },
        orderType: { type: 'string', enum: ['market', 'limit'], description: 'Order type (default: market)' },
        limitPrice: { type: 'number', description: 'Limit price (required for limit orders)' },
        timeInForce: { type: 'string', enum: ['day', 'gtc', 'ioc'], description: 'Time in force (default: day)' },
      },
      required: ['symbol', 'side', 'qty'],
    },
  },
  {
    name: 'suggest_followups',
    description: 'After answering, suggest 3 follow-up questions Wes might want to ask next. Always call this at the end of your response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of 3 short follow-up questions',
        },
      },
      required: ['suggestions'],
    },
  },
];

// Actions that require user confirmation before execution
export const DANGEROUS_TOOLS = new Set(['place_order']);

// Max agentic loop iterations to prevent runaway
export const MAX_TOOL_ITERATIONS = 6;

// ═════════════════════════════════════════════════════════════════════════════
//  Tool Executor — calls /api/keisha/actions for real tools
// ═════════════════════════════════════════════════════════════════════════════

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ result: unknown; success: boolean }> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  try {
    const res = await fetch(`${baseUrl}/api/keisha/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: toolName, params: toolInput }),
    });
    const data = await res.json();
    return { result: data, success: res.ok };
  } catch {
    return { result: { error: `Failed to execute ${toolName}` }, success: false };
  }
}
