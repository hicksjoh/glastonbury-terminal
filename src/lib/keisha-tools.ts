import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { createServiceClient } from '@/lib/supabase';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { RenderCard, TradeCardData, PortfolioCardData, OptionsCardData, GuardCardData, GEXCardData, InsiderCardData } from '@/types/keisha';
import { runTradeGuard } from '@/lib/trade-guard-engine';
import { runGEXAnalysis } from '@/lib/gex-engine';

// =============================================================================
//  Keisha Native Tool Definitions -- replaces XML tag parsing
// =============================================================================

export const KEISHA_TOOLS: Tool[] = [
  {
    name: 'lookup_price',
    description: 'Look up the current price, change, volume, and key stats for a stock symbol. Works 24/7 including pre-market and after-hours — returns bid/ask, session type, and last trade time. Use this whenever Wes asks about a stock price or you need current market data.',
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
    description: 'Get details on a specific position in the Alpaca brokerage account -- qty, market value, cost basis, unrealized P&L, avg entry price.',
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
    description: 'Get a full portfolio summary -- equity, cash, buying power, position count, total market value, and total unrealized P&L.',
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
  {
    name: 'batch_lookup',
    description: 'Look up prices for multiple symbols at once. Use this instead of multiple lookup_price calls when comparing stocks or scanning candidates. Works 24/7 including after-hours.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of stock ticker symbols (max 20)',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'scan_watchlist',
    description: 'Scan all watchlist symbols for trading opportunities. Returns the top picks ranked by a quick momentum + value score.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Number of top picks to return (default 3)' },
      },
      required: [],
    },
  },
  {
    name: 'lookup_options',
    description: 'Look up options chain data for a symbol. Returns the nearest expirations with strikes around the current price, including bid, ask, IV, delta, and open interest. Use when Wes asks about options, premiums, covered calls, or Greeks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        type: { type: 'string', enum: ['call', 'put'], description: 'Filter by option type (default: both)' },
      },
      required: ['symbol'],
    },
  },
  {
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
  },
  {
    name: 'check_gex',
    description: 'Check gamma exposure (GEX) levels and volatility regime for a symbol. Shows put wall, call wall, gamma flip point, high-volume level, net GEX, and whether dealers are suppressing or amplifying volatility. Use when Wes asks about GEX, gamma, dealer positioning, volatility expectations, or when analyzing options strategies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock or ETF ticker symbol (e.g., SPY, AAPL, QQQ)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'check_insider',
    description: 'Look up insider trading and congressional stock trades for a symbol. Shows recent buys/sells by company insiders and members of Congress. Detects cluster buy signals. Use when Wes asks about insider activity, congressional trades, or smart money moves.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        days: { type: 'number', description: 'Number of days to look back (default 30)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'pin_memory',
    description: "Save a memory or note for future reference. Use when Wes says 'remember this', establishes a rule, or wants to note something for later.",
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The memory or note to save' },
        category: {
          type: 'string',
          enum: ['strategy', 'rule', 'insight', 'preference'],
          description: 'Category for the memory',
        },
        symbol: { type: 'string', description: 'Related stock ticker symbol (optional)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall_memories',
    description: "Recall saved memories and notes. Use when Wes asks 'what did I say about X' or when you need to check a prior decision.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query to filter memories by content' },
        symbol: { type: 'string', description: 'Filter memories by stock ticker symbol' },
        limit: { type: 'number', description: 'Max number of memories to return (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'delete_memory',
    description: 'Remove a saved memory pin by setting it inactive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory pin to deactivate' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_market_narrative',
    description: 'Get the latest AI-generated market narrative explaining what is happening in the market right now and why. Returns a concise, authoritative summary with sentiment, regime, and key price levels.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_congress_trades',
    description: 'Get recent congressional trades (Senate + House). Shows what politicians are buying and selling. Can filter by ticker. Use when Wes asks about Congress trading activity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker to filter by (e.g., NVDA)' },
      },
      required: [],
    },
  },
  {
    name: 'get_weekly_replay_summary',
    description: 'Get a weekly trading performance summary from AI trade replays. Returns average grades, total money left on table, most common lessons, best/worst trades. Use when Wes asks how he traded this week.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// Actions that require user confirmation before execution
export const DANGEROUS_TOOLS = new Set(['place_order']);

// Max agentic loop iterations to prevent runaway
export const MAX_TOOL_ITERATIONS = 6;

// =============================================================================
//  Direct Tool Executor -- runs in-process, no HTTP round-trip
// =============================================================================

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ result: unknown; success: boolean }> {
  try {
    switch (toolName) {
      case 'lookup_price': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const alpacaHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        // Primary: Alpaca snapshot — works 24/7 including after-hours
        try {
          const snapRes = await fetch(
            `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot`,
            { headers: alpacaHeaders },
          );

          if (snapRes.ok) {
            const snap = await snapRes.json();
            const price = snap.latestTrade?.p ?? snap.dailyBar?.c;
            const prevClose = snap.prevDailyBar?.c;
            const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
            const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null;

            // Determine market session
            const now = new Date();
            const hour = now.getUTCHours();
            const isRegularHours = hour >= 13.5 && hour < 20; // 9:30 AM - 4 PM ET
            const session = isRegularHours ? 'regular' : 'extended';

            const result: Record<string, unknown> = {
              symbol,
              price,
              change,
              changePct,
              volume: snap.dailyBar?.v ?? null,
              dayHigh: snap.dailyBar?.h ?? null,
              dayLow: snap.dailyBar?.l ?? null,
              prevClose,
              session,
              bidPrice: snap.latestQuote?.bp ?? null,
              askPrice: snap.latestQuote?.ap ?? null,
              lastTradeTime: snap.latestTrade?.t ?? null,
            };

            // Try FMP for extra stats (marketCap, yearHigh/Low) — non-blocking
            const fmpKey = process.env.FMP_API_KEY;
            if (fmpKey) {
              try {
                const fmpRes = await fetch(
                  `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpKey}`,
                  { signal: AbortSignal.timeout(3000) },
                );
                const fmpData = await fmpRes.json();
                if (Array.isArray(fmpData) && fmpData[0]) {
                  result.marketCap = fmpData[0].marketCap;
                  result.yearHigh = fmpData[0].yearHigh;
                  result.yearLow = fmpData[0].yearLow;
                  result.pe = fmpData[0].pe;
                }
              } catch { /* FMP unavailable — Alpaca data is sufficient */ }
            }

            return { result, success: true };
          }
        } catch (alpacaErr) {
          console.error(`Alpaca snapshot failed for ${symbol}:`, alpacaErr);
        }

        // Fallback: FMP only
        const fmpKey = process.env.FMP_API_KEY;
        if (fmpKey) {
          const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpKey}`);
          const data = await res.json();
          if (Array.isArray(data) && data[0]) {
            const quote = data[0];
            return {
              result: {
                symbol,
                price: quote.price,
                change: quote.change,
                changePct: quote.changesPercentage,
                volume: quote.volume,
                marketCap: quote.marketCap,
                dayHigh: quote.dayHigh,
                dayLow: quote.dayLow,
                yearHigh: quote.yearHigh,
                yearLow: quote.yearLow,
                session: 'unknown',
              },
              success: true,
            };
          }
        }

        return { result: { error: `No data available for ${symbol}` }, success: false };
      }

      case 'get_position': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        const res = await fetch(`${baseUrl}/v2/positions/${symbol}`, {
          headers: {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
          },
        });

        if (!res.ok) return { result: { error: `No position in ${symbol}` }, success: false };

        const pos = await res.json();
        return {
          result: {
            symbol: pos.symbol,
            qty: parseFloat(pos.qty),
            marketValue: parseFloat(pos.market_value),
            costBasis: parseFloat(pos.cost_basis),
            unrealizedPl: parseFloat(pos.unrealized_pl),
            unrealizedPlPct: (parseFloat(pos.unrealized_plpc) * 100).toFixed(2) + '%',
            currentPrice: parseFloat(pos.current_price),
            avgEntry: parseFloat(pos.avg_entry_price),
          },
          success: true,
        };
      }

      case 'portfolio_summary': {
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
      }

      case 'add_watchlist': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const supabase = createServiceClient();

        const { data: existing } = await supabase.from('watchlist')
          .select('id').eq('symbol', symbol).limit(1);

        if (existing && existing.length > 0) {
          return { result: { message: `${symbol} is already on your watchlist` }, success: true };
        }

        let companyName = symbol;
        let currentPrice = null;
        try {
          const fmpKey = process.env.FMP_API_KEY;
          if (fmpKey) {
            const res = await fetch(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${fmpKey}`);
            const data = await res.json();
            if (Array.isArray(data) && data[0]) {
              companyName = data[0].companyName || symbol;
              currentPrice = data[0].price;
            }
          }
        } catch { /* non-critical */ }

        const { error } = await supabase.from('watchlist').insert({
          symbol,
          company_name: companyName,
          current_price: currentPrice,
          added_at: new Date().toISOString(),
        });

        if (error) return { result: { error: error.message }, success: false };
        return { result: { message: `Added ${symbol} (${companyName}) to watchlist` }, success: true };
      }

      case 'remove_watchlist': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const supabase = createServiceClient();
        const { error } = await supabase.from('watchlist').delete().eq('symbol', symbol);
        if (error) return { result: { error: error.message }, success: false };
        return { result: { message: `Removed ${symbol} from watchlist` }, success: true };
      }

      case 'update_watchlist_target': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const supabase = createServiceClient();
        const updates: Record<string, unknown> = {};
        if (toolInput.buyTarget !== undefined) updates.buy_target = parseFloat(String(toolInput.buyTarget));
        if (toolInput.sellTarget !== undefined) updates.sell_target = parseFloat(String(toolInput.sellTarget));
        if (toolInput.notes !== undefined) updates.notes = toolInput.notes;

        const { error } = await supabase.from('watchlist').update(updates).eq('symbol', symbol);
        if (error) return { result: { error: error.message }, success: false };
        return { result: { message: `Updated ${symbol} targets` }, success: true };
      }

      case 'set_alert': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        const condition = String(toolInput.condition || 'price_above');
        const value = parseFloat(String(toolInput.value));

        if (!symbol || isNaN(value)) return { result: { error: 'Missing symbol or value' }, success: false };

        const supabase = createServiceClient();
        const { error } = await supabase.from('alerts').insert({
          name: `${symbol} ${condition.replace('_', ' ')} ${value}`,
          symbol,
          rules: [{ metric: condition.startsWith('pct') ? 'pct_change' : 'price', operator: condition.includes('above') || condition.includes('pct') ? '>' : '<', value }],
          logic: 'AND',
          active: true,
          created_at: new Date().toISOString(),
        });

        if (error) return { result: { error: error.message }, success: false };
        return { result: { message: `Alert set: ${symbol} ${condition.replace('_', ' ')} $${value}` }, success: true };
      }

      case 'batch_lookup': {
        const rawSymbols = toolInput.symbols as string[] | undefined;
        if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
          return { result: { error: 'Missing or empty symbols array' }, success: false };
        }
        const symbols = rawSymbols.slice(0, 20).map((s) => sanitizeSymbol(String(s))).filter(Boolean);
        if (symbols.length === 0) return { result: { error: 'No valid symbols provided' }, success: false };

        const alpacaHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        const symbolsParam = symbols.join(',');

        // Fetch snapshots and 5-day bars in parallel
        const [snapRes, barsRes] = await Promise.all([
          fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbolsParam}`, {
            headers: alpacaHeaders,
          }),
          fetch(
            `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbolsParam}&timeframe=1Day&limit=5`,
            { headers: alpacaHeaders },
          ),
        ]);

        if (!snapRes.ok) {
          return { result: { error: `Alpaca snapshot request failed: ${snapRes.status}` }, success: false };
        }

        const snapshots = await snapRes.json();

        // Parse bars response — keyed by symbol, each has an array of bars
        let barsData: Record<string, { c: number }[]> = {};
        if (barsRes.ok) {
          const barsJson = await barsRes.json();
          barsData = barsJson.bars || barsJson || {};
        }

        const now = new Date();
        const hour = now.getUTCHours();
        const isRegularHours = hour >= 13.5 && hour < 20;
        const session = isRegularHours ? 'regular' : 'extended';

        const results: Record<string, unknown> = {};
        for (const sym of symbols) {
          const snap = snapshots[sym];
          if (!snap) {
            results[sym] = { error: 'No data' };
            continue;
          }
          const price = snap.latestTrade?.p ?? snap.dailyBar?.c;
          const prevClose = snap.prevDailyBar?.c;
          const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
          const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null;

          const symbolBars = barsData[sym] || [];
          const bars = symbolBars.map((b: { c: number }) => b.c);

          results[sym] = {
            price,
            change,
            changePct,
            volume: snap.dailyBar?.v ?? null,
            dayHigh: snap.dailyBar?.h ?? null,
            dayLow: snap.dailyBar?.l ?? null,
            prevClose,
            bidPrice: snap.latestQuote?.bp ?? null,
            askPrice: snap.latestQuote?.ap ?? null,
            session,
            bars,
          };
        }

        return { result: { results }, success: true };
      }

      case 'scan_watchlist': {
        const limit = Math.min(Math.max(Number(toolInput.limit) || 3, 1), 20);
        const supabase = createServiceClient();

        // 1. Get all watchlist symbols
        const { data: watchlistRows, error: wlError } = await supabase
          .from('watchlist')
          .select('symbol, buy_target, sell_target, notes');

        if (wlError || !watchlistRows || watchlistRows.length === 0) {
          return {
            result: { error: wlError?.message || 'Watchlist is empty' },
            success: !wlError,
          };
        }

        const symbols = watchlistRows.map((r: { symbol: string }) => r.symbol);
        const symbolsParam = symbols.join(',');

        // 2. Batch snapshot lookup
        const alpacaHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        const snapRes = await fetch(
          `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbolsParam}`,
          { headers: alpacaHeaders },
        );

        if (!snapRes.ok) {
          return { result: { error: `Alpaca snapshot failed: ${snapRes.status}` }, success: false };
        }

        const snapshots = await snapRes.json();

        // 3. Score each symbol
        const scored: {
          symbol: string;
          score: number;
          price: number;
          change: number;
          changePct: number;
          volume: number;
          buyTarget: number | null;
          sellTarget: number | null;
          notes: string | null;
          reasons: string[];
        }[] = [];

        for (const row of watchlistRows) {
          const sym = row.symbol as string;
          const snap = snapshots[sym];
          if (!snap) continue;

          const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
          const prevClose = snap.prevDailyBar?.c ?? 0;
          const volume = snap.dailyBar?.v ?? 0;
          const change = price && prevClose ? +(price - prevClose).toFixed(2) : 0;
          const changePct = price && prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;
          const buyTarget = (row as Record<string, unknown>).buy_target as number | null;
          const sellTarget = (row as Record<string, unknown>).sell_target as number | null;
          const notes = (row as Record<string, unknown>).notes as string | null;

          let score = 0;
          const reasons: string[] = [];

          // +2 momentum: price above previous close
          if (price > prevClose && prevClose > 0) {
            score += 2;
            reasons.push('momentum (above prev close)');
          }

          // +2 value: within 5% of buy target
          if (buyTarget && buyTarget > 0 && price > 0) {
            const distPct = Math.abs((price - buyTarget) / buyTarget) * 100;
            if (distPct <= 5) {
              score += 2;
              reasons.push(`near buy target ($${buyTarget})`);
            }
          }

          // +1 volume: > 1M shares
          if (volume > 1_000_000) {
            score += 1;
            reasons.push('high volume (>1M)');
          }

          scored.push({
            symbol: sym,
            score,
            price,
            change,
            changePct,
            volume,
            buyTarget,
            sellTarget,
            notes,
            reasons,
          });
        }

        // 4. Sort by score descending, take top N
        scored.sort((a, b) => b.score - a.score);
        const topPicks = scored.slice(0, limit);

        return {
          result: { topPicks, totalScanned: symbols.length },
          success: true,
        };
      }

      case 'lookup_options': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const optionType = toolInput.type as 'call' | 'put' | undefined;

        const alpacaHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        const ALPACA_DATA_URL = 'https://data.alpaca.markets';
        const ALPACA_TRADING_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

        // 1. Get current stock price
        let currentPrice = 0;
        try {
          const quoteRes = await fetch(
            `${ALPACA_DATA_URL}/v2/stocks/${symbol}/snapshot`,
            { headers: alpacaHeaders },
          );
          if (quoteRes.ok) {
            const quoteData = await quoteRes.json();
            currentPrice = quoteData.latestTrade?.p ?? quoteData.dailyBar?.c ?? 0;
          }
        } catch { /* proceed without price */ }

        if (currentPrice === 0) {
          return { result: { error: `Could not get current price for ${symbol}` }, success: false };
        }

        // 2. Fetch option contracts (next 45 days)
        const today = new Date().toISOString().slice(0, 10);
        const futureDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const contractParams = new URLSearchParams({
          underlying_symbols: symbol,
          status: 'active',
          expiration_date_gte: today,
          expiration_date_lte: futureDate,
          limit: '100',
        });

        const contractsRes = await fetch(
          `${ALPACA_TRADING_URL}/v2/options/contracts?${contractParams}`,
          { headers: alpacaHeaders },
        );

        if (!contractsRes.ok) {
          return { result: { error: `Options contracts request failed: ${contractsRes.status}` }, success: false };
        }

        const contractsData = await contractsRes.json();
        let contracts: {
          symbol: string;
          type: string;
          strike_price: string;
          expiration_date: string;
          open_interest?: number;
        }[] = contractsData.option_contracts || contractsData.contracts || [];

        // 3. Filter by type if specified
        if (optionType) {
          contracts = contracts.filter((c) => c.type === optionType);
        }

        if (contracts.length === 0) {
          return { result: { symbol, currentPrice, expirations: [], message: 'No option contracts found' }, success: true };
        }

        // 4. Group by expiration, find 5 nearest strikes per expiration
        const byExpiration = new Map<string, typeof contracts>();
        for (const c of contracts) {
          const exp = c.expiration_date;
          if (!byExpiration.has(exp)) byExpiration.set(exp, []);
          byExpiration.get(exp)!.push(c);
        }

        const selectedContracts: typeof contracts = [];
        Array.from(byExpiration.values()).forEach((expContracts) => {
          // Sort by distance from current price
          expContracts.sort(
            (a, b) =>
              Math.abs(Number(a.strike_price) - currentPrice) -
              Math.abs(Number(b.strike_price) - currentPrice),
          );
          selectedContracts.push(...expContracts.slice(0, 10)); // 5 calls + 5 puts nearest ATM
        });

        // 5. Get snapshots for selected contracts
        const contractSymbols = selectedContracts.map((c) => c.symbol);
        const snapshotParams = new URLSearchParams();
        snapshotParams.set('symbols', contractSymbols.join(','));

        let snapshots: Record<string, {
          latestQuote?: { bp: number; ap: number };
          latestTrade?: { p: number; s: number };
          greeks?: { delta: number; gamma: number; theta: number; vega: number };
          impliedVolatility?: number;
          openInterest?: number;
        }> = {};

        try {
          const snapshotRes = await fetch(
            `${ALPACA_DATA_URL}/v1beta1/options/snapshots?${snapshotParams}`,
            { headers: alpacaHeaders },
          );
          if (snapshotRes.ok) {
            const snapshotData = await snapshotRes.json();
            snapshots = snapshotData.snapshots || snapshotData || {};
          }
        } catch { /* proceed with empty snapshots */ }

        // 6. Build grouped response
        const expirationMap = new Map<string, {
          date: string;
          contracts: {
            symbol: string;
            strike: number;
            type: string;
            bid: number;
            ask: number;
            last: number;
            iv: number;
            delta: number;
            openInterest: number;
            volume: number;
          }[];
        }>();

        for (const contract of selectedContracts) {
          const exp = contract.expiration_date;
          if (!expirationMap.has(exp)) {
            expirationMap.set(exp, { date: exp, contracts: [] });
          }

          const snap = snapshots[contract.symbol];
          expirationMap.get(exp)!.contracts.push({
            symbol: contract.symbol,
            strike: Number(contract.strike_price),
            type: contract.type,
            bid: Number(snap?.latestQuote?.bp) || 0,
            ask: Number(snap?.latestQuote?.ap) || 0,
            last: Number(snap?.latestTrade?.p) || 0,
            iv: Number(snap?.impliedVolatility) || 0,
            delta: Number(snap?.greeks?.delta) || 0,
            openInterest: Number(snap?.openInterest ?? contract.open_interest) || 0,
            volume: Number(snap?.latestTrade?.s) || 0,
          });
        }

        // Sort contracts within each expiration by strike
        const expirations = Array.from(expirationMap.values()).sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        for (const exp of expirations) {
          exp.contracts.sort((a, b) => a.strike - b.strike);
        }

        return {
          result: { symbol, currentPrice, expirations },
          success: true,
        };
      }

      case 'check_trade_guard': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const side = String(toolInput.side || 'buy') as 'buy' | 'sell';
        const quantity = Number(toolInput.quantity) || 10;
        let price = Number(toolInput.price) || 0;

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
      }

      case 'check_gex': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || 'SPY'));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

        const gexResult = await runGEXAnalysis(symbol);
        return { result: gexResult, success: true };
      }

      case 'check_insider': {
        const symbol = sanitizeSymbol(String(toolInput.symbol || ''));
        if (!symbol) return { result: { error: 'Missing symbol' }, success: false };
        const days = Math.min(Number(toolInput.days) || 30, 90);
        const fmpKey = process.env.FMP_API_KEY;
        if (!fmpKey) return { result: { error: 'FMP_API_KEY not configured' }, success: false };

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        // Fetch insider + congress data in parallel
        const [insiderRes, senateRes, disclosureRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/api/v4/insider-trading?symbol=${symbol}&limit=50&apikey=${fmpKey}`).catch(() => null),
          fetch(`https://financialmodelingprep.com/api/v4/senate-trading?symbol=${symbol}&apikey=${fmpKey}`).catch(() => null),
          fetch(`https://financialmodelingprep.com/api/v4/senate-disclosure?symbol=${symbol}&apikey=${fmpKey}`).catch(() => null),
        ]);

        const insiderRaw = insiderRes?.ok ? await insiderRes.json() : [];
        const insiderTrades = (Array.isArray(insiderRaw) ? insiderRaw : [])
          .filter((t: Record<string, unknown>) => new Date(String(t.transactionDate || t.filingDate || '')) >= cutoff)
          .slice(0, 20)
          .map((t: Record<string, unknown>) => ({
            name: String(t.reportingName || t.owner || 'Unknown'),
            title: String(t.typeOfOwner || ''),
            transactionType: String(t.acquistionOrDisposition || '').toLowerCase().includes('a') ? 'buy' : 'sell',
            shares: Number(t.securitiesTransacted || 0),
            totalValue: Number(t.securitiesTransacted || 0) * Number(t.price || 0),
            date: String(t.transactionDate || t.filingDate || ''),
          }));

        const congressTrades: Array<Record<string, unknown>> = [];
        for (const res of [senateRes, disclosureRes]) {
          const raw = res?.ok ? await res.json() : [];
          if (!Array.isArray(raw)) continue;
          for (const t of raw) {
            if (new Date(t.transactionDate || t.disclosureDate || '') < cutoff) continue;
            congressTrades.push({
              representative: t.representative || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Unknown',
              party: t.party || '',
              transactionType: String(t.type || t.transactionType || '').toLowerCase().includes('purchase') ? 'buy' : 'sell',
              amount: t.amount || t.range || '',
              date: t.transactionDate || t.disclosureDate || '',
            });
          }
        }

        // Signal detection: cluster buys
        const signals: Array<{ type: string; description: string; confidence: number }> = [];
        const buys = insiderTrades.filter((t: { transactionType: string }) => t.transactionType === 'buy');
        if (buys.length >= 3) {
          const dates = buys.map((b: { date: string }) => new Date(b.date).getTime());
          const range = Math.max(...dates) - Math.min(...dates);
          if (range <= 14 * 86400000) {
            signals.push({
              type: 'cluster_buy',
              description: `${buys.length} insiders bought ${symbol} within 14 days`,
              confidence: Math.min(0.95, 0.6 + buys.length * 0.1),
            });
          }
        }

        const congressBuys = congressTrades.filter(t => t.transactionType === 'buy');
        for (const t of congressBuys.slice(0, 3)) {
          signals.push({
            type: 'congress_buy',
            description: `${t.representative} (${t.party}) purchased ${symbol}`,
            confidence: 0.7,
          });
        }

        return {
          result: {
            symbol,
            insiderTrades: insiderTrades.slice(0, 10),
            congressTrades: congressTrades.slice(0, 10),
            signals,
            summary: {
              insiderBuys: buys.length,
              insiderSells: insiderTrades.filter((t: { transactionType: string }) => t.transactionType === 'sell').length,
              congressBuys: congressBuys.length,
              congressSells: congressTrades.filter(t => t.transactionType === 'sell').length,
            },
          },
          success: true,
        };
      }

      case 'pin_memory': {
        const content = String(toolInput.content || '').trim();
        if (!content) return { result: { error: 'Missing content' }, success: false };

        const category = toolInput.category as string | undefined;
        const symbol = toolInput.symbol ? sanitizeSymbol(String(toolInput.symbol)) : null;

        const supabase = createServiceClient();
        const { data, error } = await supabase.from('keisha_memory_pins').insert({
          content,
          category: category || null,
          symbol,
          active: true,
          created_at: new Date().toISOString(),
        }).select('id');

        if (error) return { result: { error: error.message }, success: false };
        return {
          result: {
            message: 'Memory pinned',
            id: data?.[0]?.id,
            content,
            category: category || null,
            symbol,
          },
          success: true,
        };
      }

      case 'recall_memories': {
        const query = toolInput.query as string | undefined;
        const symbol = toolInput.symbol ? sanitizeSymbol(String(toolInput.symbol)) : undefined;
        const limit = Math.min(Math.max(Number(toolInput.limit) || 10, 1), 50);

        const supabase = createServiceClient();
        let q = supabase
          .from('keisha_memory_pins')
          .select('id, content, category, symbol, created_at')
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (symbol) {
          q = q.eq('symbol', symbol);
        }
        if (query) {
          q = q.ilike('content', `%${query}%`);
        }

        const { data, error } = await q;
        if (error) return { result: { error: error.message }, success: false };
        return {
          result: { memories: data || [], count: data?.length || 0 },
          success: true,
        };
      }

      case 'delete_memory': {
        const id = String(toolInput.id || '').trim();
        if (!id) return { result: { error: 'Missing memory id' }, success: false };

        const supabase = createServiceClient();
        const { error } = await supabase
          .from('keisha_memory_pins')
          .update({ active: false })
          .eq('id', id);

        if (error) return { result: { error: error.message }, success: false };
        return { result: { message: 'Memory deactivated', id }, success: true };
      }

      case 'get_congress_trades': {
        const congressBaseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
        try {
          const params = new URLSearchParams();
          const filterTicker = String(toolInput.ticker || '').trim();
          if (filterTicker) params.set('ticker', sanitizeSymbol(filterTicker));
          const res = await fetch(`${congressBaseUrl}/api/congress?${params}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            return { result: { error: `Congress API returned ${res.status}` }, success: false };
          }
          const congressData = await res.json();
          const congressTrades = (congressData.trades || []).slice(0, 15);
          return {
            result: {
              total: congressData.total || 0,
              trades: congressTrades.map((t: Record<string, unknown>) => ({
                politician: t.politician,
                party: t.party,
                ticker: t.ticker,
                type: t.transaction_type,
                amount: t.amount_range,
                date: t.date_traded,
              })),
            },
            success: true,
          };
        } catch (congressErr) {
          const congressMsg = congressErr instanceof Error ? congressErr.message : 'Congress fetch failed';
          return { result: { error: congressMsg }, success: false };
        }
      }

      case 'get_market_narrative': {
        const narrativeBaseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';
        try {
          const res = await fetch(`${narrativeBaseUrl}/api/narrative`, {
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) {
            return { result: { error: `Narrative API returned ${res.status}` }, success: false };
          }
          const narrativeData = await res.json();
          return { result: narrativeData, success: true };
        } catch (fetchErr) {
          const fetchMsg = fetchErr instanceof Error ? fetchErr.message : 'Narrative fetch failed';
          return { result: { error: fetchMsg }, success: false };
        }
      }

      case 'get_weekly_replay_summary': {
        try {
          const replaySupabase = createServiceClient();
          const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data: replays, error: replaysErr } = await replaySupabase
            .from('trade_replays')
            .select('symbol, side, pnl, entry_grade, exit_grade, money_left_on_table, replay_data')
            .gte('created_at', weekAgo)
            .order('created_at', { ascending: false })
            .limit(50);

          if (replaysErr) {
            return { result: { error: replaysErr.message }, success: false };
          }

          if (!replays || replays.length === 0) {
            return { result: { message: 'No trade replays from the past 7 days. Generate post-mortems from the Journal page first.' }, success: true };
          }

          const gradeVal: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
          const gradeFromVal = (v: number): string => {
            if (v >= 3.5) return 'A';
            if (v >= 2.5) return 'B';
            if (v >= 1.5) return 'C';
            if (v >= 0.5) return 'D';
            return 'F';
          };

          let entrySum = 0, exitSum = 0, totalLeft = 0, totalPnl = 0;
          let bestPnl = -Infinity, worstPnl = Infinity;
          let bestTrade = '', worstTrade = '';
          const lessons: string[] = [];

          for (const r of replays) {
            entrySum += gradeVal[r.entry_grade] || 2;
            exitSum += gradeVal[r.exit_grade] || 2;
            totalLeft += Number(r.money_left_on_table || 0);
            const pnl = Number(r.pnl || 0);
            totalPnl += pnl;
            if (pnl > bestPnl) { bestPnl = pnl; bestTrade = `${r.symbol} (${r.side})`; }
            if (pnl < worstPnl) { worstPnl = pnl; worstTrade = `${r.symbol} (${r.side})`; }
            const rd = r.replay_data as Record<string, unknown> | null;
            if (rd?.lesson) lessons.push(String(rd.lesson));
          }

          const count = replays.length;
          return {
            result: {
              tradeCount: count,
              avgEntryGrade: gradeFromVal(entrySum / count),
              avgExitGrade: gradeFromVal(exitSum / count),
              totalMoneyLeftOnTable: Math.round(totalLeft),
              totalPnl: Math.round(totalPnl),
              bestTrade: `${bestTrade} ($${bestPnl.toFixed(0)})`,
              worstTrade: `${worstTrade} ($${worstPnl.toFixed(0)})`,
              topLessons: lessons.slice(0, 3),
            },
            success: true,
          };
        } catch (replayErr) {
          const replayMsg = replayErr instanceof Error ? replayErr.message : 'Weekly summary failed';
          return { result: { error: replayMsg }, success: false };
        }
      }

      default:
        return { result: { error: `Unknown tool: ${toolName}` }, success: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution failed';
    console.error(`Tool ${toolName} error:`, msg);
    return { result: { error: msg }, success: false };
  }
}

// =============================================================================
//  Build RenderCard from tool results — powers inline rich cards in chat
// =============================================================================

export function buildRenderCard(
  toolName: string,
  toolInput: Record<string, unknown>,
  result: unknown,
  success: boolean,
): RenderCard | null {
  if (!success || !result || typeof result !== 'object') return null;

  const r = result as Record<string, unknown>;

  switch (toolName) {
    case 'lookup_price': {
      if (!r.price) return null;
      return {
        type: 'trade',
        data: {
          symbol: String(r.symbol || toolInput.symbol || ''),
          currentPrice: Number(r.price),
          change: Number(r.change || 0),
          changePct: Number(r.changePct || 0),
        } as TradeCardData,
      };
    }

    case 'get_position': {
      if (!r.symbol) return null;
      return {
        type: 'trade',
        data: {
          symbol: String(r.symbol),
          currentPrice: Number(r.currentPrice || 0),
          change: 0,
          changePct: 0,
          positionQty: Number(r.qty || 0),
          positionPnl: Number(r.unrealizedPl || 0),
          positionPnlPct: parseFloat(String(r.unrealizedPlPct || '0')),
        } as TradeCardData,
      };
    }

    case 'portfolio_summary': {
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
    }

    case 'lookup_options': {
      const expirations = r.expirations as Array<{
        date: string;
        contracts: Array<{
          symbol: string;
          strike: number;
          type: string;
          bid: number;
          ask: number;
          last: number;
          iv: number;
          delta: number;
        }>;
      }> | undefined;
      if (!expirations || expirations.length === 0) return null;
      const firstExp = expirations[0];
      if (!firstExp.contracts || firstExp.contracts.length === 0) return null;
      // Pick the nearest ATM contract
      const contract = firstExp.contracts[0];
      const premium = contract.ask || contract.last || 0;
      return {
        type: 'options',
        data: {
          symbol: String(r.symbol || toolInput.symbol || ''),
          expiration: firstExp.date,
          strike: Number(contract.strike),
          type: contract.type === 'put' ? 'put' : 'call',
          premium,
          iv: Number((contract.iv * 100).toFixed(1)),
          greeks: {
            delta: Number(contract.delta || 0),
            gamma: 0,
            theta: 0,
            vega: 0,
          },
          breakeven: contract.type === 'call'
            ? Number(contract.strike) + premium
            : Number(contract.strike) - premium,
        } as OptionsCardData,
      };
    }

    case 'check_gex': {
      if (!r.regime) return null;
      return {
        type: 'gex',
        data: {
          symbol: String(r.symbol || toolInput.symbol || 'SPY'),
          spotPrice: Number(r.spotPrice || 0),
          netGEX: Number(r.netGEX || 0),
          regime: String(r.regime) as 'positive' | 'negative',
          impact: String(r.impact || ''),
          levels: {
            putWall: Number((r.levels as Record<string, unknown>)?.putWall || 0),
            callWall: Number((r.levels as Record<string, unknown>)?.callWall || 0),
            hvl: Number((r.levels as Record<string, unknown>)?.hvl || 0),
            gammaFlip: Number((r.levels as Record<string, unknown>)?.gammaFlip || 0),
            pinStrikes: ((r.levels as Record<string, unknown>)?.pinStrikes as number[]) || [],
          },
          dataSource: String(r.dataSource || 'synthetic'),
        } as GEXCardData,
      };
    }

    case 'check_insider': {
      if (!r.symbol) return null;
      return {
        type: 'insider',
        data: {
          symbol: String(r.symbol),
          insiderTrades: ((r.insiderTrades as Array<Record<string, unknown>>) || []).slice(0, 5).map(t => ({
            name: String(t.name || ''),
            title: String(t.title || ''),
            transactionType: String(t.transactionType || 'buy') as 'buy' | 'sell',
            shares: Number(t.shares || 0),
            totalValue: Number(t.totalValue || 0),
            date: String(t.date || ''),
          })),
          congressTrades: ((r.congressTrades as Array<Record<string, unknown>>) || []).slice(0, 5).map(t => ({
            representative: String(t.representative || ''),
            party: String(t.party || ''),
            transactionType: String(t.transactionType || ''),
            amount: String(t.amount || ''),
            date: String(t.date || ''),
          })),
          signals: ((r.signals as Array<Record<string, unknown>>) || []).map(s => ({
            type: String(s.type || ''),
            description: String(s.description || ''),
            confidence: Number(s.confidence || 0),
          })),
          summary: {
            insiderBuys: Number((r.summary as Record<string, unknown>)?.insiderBuys || 0),
            insiderSells: Number((r.summary as Record<string, unknown>)?.insiderSells || 0),
            congressBuys: Number((r.summary as Record<string, unknown>)?.congressBuys || 0),
            congressSells: Number((r.summary as Record<string, unknown>)?.congressSells || 0),
          },
        } as InsiderCardData,
      };
    }

    case 'check_trade_guard': {
      if (!r.verdict) return null;
      return {
        type: 'guard',
        data: {
          verdict: String(r.verdict) as 'CLEAR' | 'CAUTION' | 'STOP',
          verdictMessage: String(r.verdictMessage || ''),
          symbol: String((r as Record<string, unknown>).symbol || toolInput.symbol || ''),
          side: String(toolInput.side || 'buy') as 'buy' | 'sell',
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
    }

    default:
      return null;
  }
}
