import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { createServiceClient } from '@/lib/supabase';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { RenderCard, TradeCardData, PortfolioCardData, OptionsCardData, GuardCardData, GEXCardData, InsiderCardData } from '@/types/keisha';
import { runTradeGuard } from '@/lib/trade-guard-engine';
import { runGEXAnalysis } from '@/lib/gex-engine';
import {
  type FilingStatus,
  TAX_DISCLAIMER,
  ACTIVE_TAX_YEAR,
  calculateIncomeTax,
  calculateCapitalGainsTax,
  calculateNIIT,
  classifyHoldingPeriod,
  calculateSection1256Tax,
  estimateQuarterlyPayment,
  getTaxBracketInfo,
  calculateSection179,
  calculateMileageDeduction,
  calculateHomeOfficeDeduction,
  calculateSEPContribution,
} from '@/lib/tax-engine';
import { getWashSalePreview, getUpcomingWindowCloses, scanPortfolioForWashSales, type TradeRecord } from '@/lib/wash-sale-detector';
import { compareLotMethods, type TaxLot } from '@/lib/tax-lot-optimizer';
import { scanForHarvestCandidates, type HarvestPosition } from '@/lib/tax-loss-harvester';
import { generateForm8949Data, exportForm8949CSV, generateScheduleDSummary } from '@/lib/tax-export';

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
  // ─── Tax Tools ──────────────────────────────────────────────────────────
  {
    name: 'get_tax_estimate',
    description: 'Calculate estimated federal income tax and capital gains tax for a given income and filing status. Returns bracket breakdown, effective rate, marginal rate, NIIT, and quarterly estimates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ordinary_income: { type: 'number', description: 'Projected ordinary income for the year' },
        short_term_gains: { type: 'number', description: 'Short-term capital gains (taxed as ordinary)' },
        long_term_gains: { type: 'number', description: 'Long-term capital gains' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
        ytd_tax_paid: { type: 'number', description: 'Year-to-date tax already paid/withheld' },
      },
      required: ['ordinary_income', 'filing_status'],
    },
  },
  {
    name: 'check_wash_sale',
    description: 'Check if selling a position would trigger a wash sale based on recent trade history. Also checks for upcoming window closes where it becomes safe to rebuy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker to check' },
        action: { type: 'string', enum: ['buy', 'sell'], description: 'Proposed action' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_harvest_candidates',
    description: 'Scan portfolio for tax-loss harvesting opportunities. Returns positions with unrealized losses, potential tax savings, and replacement security suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_loss: { type: 'number', description: 'Minimum unrealized loss to include (default $100)' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status for savings calc' },
      },
      required: [],
    },
  },
  {
    name: 'compare_tax_lots',
    description: 'Compare FIFO, LIFO, and HIFO lot selection methods for selling a position. Shows tax impact of each method so user can pick the optimal one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        quantity: { type: 'number', description: 'Number of shares to sell' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: ['ticker', 'quantity'],
    },
  },
  {
    name: 'get_holding_periods',
    description: 'Check holding periods for all open positions. Flags positions approaching long-term status and shows days until conversion.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional: check specific ticker. Omit for all positions.' },
      },
      required: [],
    },
  },
  {
    name: 'calculate_section_1256',
    description: 'Calculate Section 1256 (60/40 rule) tax treatment for futures and index options. Shows tax savings vs all-short-term treatment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        total_gain: { type: 'number', description: 'Total gain/loss on Section 1256 contracts' },
        ordinary_income: { type: 'number', description: 'Other ordinary income for the year' },
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: ['total_gain', 'ordinary_income', 'filing_status'],
    },
  },
  {
    name: 'get_tax_suggestions',
    description: 'Generate proactive tax optimization suggestions based on current portfolio, YTD trades, and time of year. Returns prioritized actionable recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filing_status: { type: 'string', enum: ['single', 'mfj', 'mfs', 'hoh'], description: 'Filing status' },
      },
      required: [],
    },
  },
  {
    name: 'export_tax_report',
    description: 'Generate a Form 8949-compatible CSV export of all realized trades for a tax year. Perfect for sending to your CPA. Returns CSV data and Schedule D summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tax_year: { type: 'number', description: 'Tax year to export (default: current year)' },
      },
      required: [],
    },
  },
  {
    name: 'calculate_business_deductions',
    description: 'Calculate business tax deductions — Section 179 expensing, mileage, home office, and SEP-IRA contributions for The Glastonbury Group.',
    input_schema: {
      type: 'object' as const,
      properties: {
        miles_driven: { type: 'number', description: 'Business miles driven this year' },
        home_office_sqft: { type: 'number', description: 'Dedicated home office square footage' },
        equipment_purchases: { type: 'number', description: 'Business equipment purchased (Section 179)' },
        net_self_employment: { type: 'number', description: 'Net self-employment income (for SEP-IRA calc)' },
      },
      required: [],
    },
  },
  {
    name: 'order_ticket',
    description: 'Return an interactive order-ticket widget for a stock ticker. Use this when Wes asks "buy me X shares of TSLA" or wants to preview an order — the widget lets him review in the /trading page before executing. NEVER places the order; it only opens the ticket. Include a limit price if you have strong conviction; omit for market order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy or sell' },
        qty: { type: 'number', description: 'Share count' },
        limit: { type: 'number', description: 'Optional limit price; omit for market' },
      },
      required: ['ticker', 'side', 'qty'],
    },
  },
  {
    name: 'mini_chart',
    description: 'Return a small inline price sparkline widget for a ticker. Use it when Wes asks about price action and a visual helps. Pick an appropriate timeframe based on the question (1D for intraday, 1M for "past month", etc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
        timeframe: { type: 'string', enum: ['1D', '5D', '1M', '3M', '6M', '1Y'], description: 'Timeframe' },
      },
      required: ['ticker', 'timeframe'],
    },
  },
  {
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
  },
  {
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
  },
  {
    name: 'get_storm_status',
    description: 'Get the current CR3 Storm Watch — active NOAA NHC alerts within 48 hours, threat levels per Seacoast FL territory, and the recommended long/short hurricane basket. Use when Wes asks about storms, hurricanes, weather risk, or Florida franchise exposure.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_tax_harvest_summary',
    description: 'Get this week\'s weekly tax-loss harvester output from /tax/harvest/weekly — total unrealized loss scanned, total estimated federal tax savings, per-position suggestions (loss + suggested ETF swap + wash-sale safety). Different from the inline harvest-candidates scan; this reads the persisted weekly run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        week_of: { type: 'string', description: 'Optional Monday-of-week ISO date (YYYY-MM-DD). Defaults to the most recent.' },
      },
      required: [],
    },
  },
  {
    name: 'get_coach_review',
    description: 'Get the latest weekly behavioral coach review — patterns detected (revenge trades, FOMO, size creep, etc), the primary rule for next week, and the review body. Use when Wes asks how he\'s trading, what patterns he\'s in, or what rule he should be following.',
    input_schema: {
      type: 'object' as const,
      properties: {
        week_of: { type: 'string', description: 'Optional Monday-of-week ISO date. Defaults to the most recent.' },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_crew_runs',
    description: 'List the most recent Trading Crew v2 verdicts — 4-specialist parallel analysis with an Opus judge synthesis. Returns ticker, verdict (BULL/BEAR/NEUTRAL/PASS), confidence, rationale, suggested trade, cost, latency. Optional ticker filter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker filter' },
        limit: { type: 'number', description: 'Max rows (1-20, default 5)' },
      },
      required: [],
    },
  },
  {
    name: 'get_earnings_memo',
    description: 'Pull the most recent post-call earnings memo for a ticker from /earnings/live — structured memo with guidance direction (up/down/flat/unclear), Keisha\'s take, and key quotes with speakers. Use when Wes asks what management said on the call or how the quarter went.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_research_memo',
    description: 'Pull the latest deep-research memo for a ticker or topic from /research — 1500-5000 word buy-side memo with inline citations. Use when Wes asks about the research he\'s commissioned on a name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Optional ticker' },
        topic_contains: { type: 'string', description: 'Optional substring to match against the topic field' },
      },
      required: [],
    },
  },
  {
    name: 'get_prediction_markets',
    description: 'Get the latest Kalshi + Polymarket probability snapshots from /macro — curated markets on Fed decisions, CPI, recession odds, elections, etc. Each row has the Yes price, 24h delta, source, volume.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Optional category filter (e.g. "fed", "economy", "election")' },
      },
      required: [],
    },
  },
  {
    name: 'semantic_search',
    description: 'Semantic-search Wes\'s indexed documents (journal entries, earnings transcripts, earnings memos, deep research memos, filings, news, debates). Returns top passages with similarity scores and citations. Use this when Wes asks "have I ever traded X before?", "what did management say about margins last quarter?", "journal entries where I mentioned FOMO", or anything that benefits from pulling from his personal corpus. Always use before making a claim about his trading history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        filter_doc_type: {
          type: 'string',
          enum: ['filing', 'transcript', 'journal', 'news', 'research', 'debate'],
          description: 'Optional filter by document type',
        },
        filter_ticker: { type: 'string', description: 'Optional ticker filter (e.g. AAPL)' },
        match_count: { type: 'number', description: 'Number of results to return (default 8, max 20)' },
      },
      required: ['query'],
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

      // ─── Tax Tool Handlers ───────────────────────────────────────────────

      case 'get_tax_estimate': {
        const ordinaryIncome = Number(toolInput.ordinary_income || 0);
        const stGains = Number(toolInput.short_term_gains || 0);
        const ltGains = Number(toolInput.long_term_gains || 0);
        const filingStatus = (String(toolInput.filing_status || 'single')) as FilingStatus;
        const ytdPaid = Number(toolInput.ytd_tax_paid || 0);

        const taxableOrdinary = Math.max(0, ordinaryIncome + stGains);
        const incomeTax = calculateIncomeTax(taxableOrdinary, filingStatus);
        const capGainsTax = calculateCapitalGainsTax(ltGains, taxableOrdinary, filingStatus);
        const niit = calculateNIIT(taxableOrdinary + ltGains, stGains + ltGains, filingStatus);
        const totalTax = incomeTax.totalTax + capGainsTax.tax + niit.niit;
        const bracketInfo = getTaxBracketInfo(taxableOrdinary, filingStatus);
        const quarterly = estimateQuarterlyPayment(taxableOrdinary + ltGains, ytdPaid, ordinaryIncome + stGains + ltGains, filingStatus);

        return {
          result: {
            filingStatus,
            ordinaryIncome,
            shortTermGains: stGains,
            longTermGains: ltGains,
            incomeTax: incomeTax.totalTax,
            capGainsTax: capGainsTax.tax,
            niit: niit.niit,
            niitApplies: niit.applies,
            totalEstimatedTax: totalTax,
            effectiveRate: (taxableOrdinary + ltGains) > 0 ? +(totalTax / (taxableOrdinary + ltGains) * 100).toFixed(2) : 0,
            marginalRate: +(bracketInfo.currentBracket * 100).toFixed(1),
            roomInBracket: bracketInfo.roomInBracket === Infinity ? 'unlimited' : bracketInfo.roomInBracket,
            nextBracketAt: bracketInfo.nextBracketAt === Infinity ? 'top bracket' : bracketInfo.nextBracketAt,
            bracketBreakdown: incomeTax.bracketBreakdown,
            quarterlyPayment: quarterly.quarterlyAmount,
            nextQuarterlyDue: quarterly.nextDueDate,
            standardDeduction: ACTIVE_TAX_YEAR.standardDeduction[filingStatus],
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'check_wash_sale': {
        const ticker = sanitizeSymbol(String(toolInput.ticker || ''));
        if (!ticker) return { result: { error: 'Missing ticker' }, success: false };
        const action = (String(toolInput.action || 'sell')) as 'buy' | 'sell';

        // Fetch trade history from Alpaca
        const washAlpacaHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };
        const washBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        let washTrades: TradeRecord[] = [];
        try {
          const since = new Date();
          since.setMonth(since.getMonth() - 3);
          const fillsRes = await fetch(
            `${washBase}/v2/account/activities/FILL?after=${since.toISOString()}&direction=desc&page_size=200`,
            { headers: washAlpacaHeaders, signal: AbortSignal.timeout(10000) },
          );
          if (fillsRes.ok) {
            const fills = await fillsRes.json() as Array<{ id: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }>;
            washTrades = fills.map(f => ({
              id: f.id,
              ticker: f.symbol,
              action: f.side === 'buy' ? 'buy' as const : 'sell' as const,
              quantity: parseFloat(f.qty),
              price: parseFloat(f.price),
              date: f.transaction_time.split('T')[0],
            }));
          }
        } catch { /* continue with empty trades */ }

        const preview = getWashSalePreview(ticker, action, washTrades);
        const windowCloses = getUpcomingWindowCloses(washTrades).filter(a => a.ticker.toUpperCase() === ticker.toUpperCase());
        const allWashSales = scanPortfolioForWashSales(washTrades).filter(a => a.ticker.toUpperCase() === ticker.toUpperCase());

        return {
          result: {
            ticker,
            action,
            wouldTriggerWashSale: preview !== null,
            preview: preview ? {
              severity: preview.severity,
              message: preview.message,
              conflictingDate: preview.details.conflictingTrade?.date,
              disallowedLoss: preview.details.disallowedLoss,
              windowEnd: preview.details.windowEnd,
            } : null,
            existingWashSales: allWashSales.map(ws => ({
              severity: ws.severity,
              message: ws.message,
              conflictingDate: ws.details.conflictingTrade?.date,
              disallowedLoss: ws.details.disallowedLoss,
            })),
            upcomingWindowCloses: windowCloses.map(wc => ({
              message: wc.message,
              windowEnd: wc.details.windowEnd,
            })),
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'get_harvest_candidates': {
        try {
          const harvestFs = (String(toolInput.filing_status || 'single')) as FilingStatus;
          const minLoss = Number(toolInput.min_loss || 100);
          const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
          const harvestRes = await fetch(
            `${baseUrl}/api/tax/harvest?filing_status=${harvestFs}&min_loss=${minLoss}`,
            { signal: AbortSignal.timeout(15000) },
          );
          if (!harvestRes.ok) {
            return { result: { error: 'Harvest scan failed', disclaimer: TAX_DISCLAIMER }, success: false };
          }
          const harvestData = await harvestRes.json();
          return { result: { ...harvestData.data, disclaimer: TAX_DISCLAIMER }, success: true };
        } catch (harvestErr) {
          const harvestMsg = harvestErr instanceof Error ? harvestErr.message : 'Harvest scan failed';
          return { result: { error: harvestMsg, disclaimer: TAX_DISCLAIMER }, success: false };
        }
      }

      case 'compare_tax_lots': {
        const lotTicker = sanitizeSymbol(String(toolInput.ticker || ''));
        if (!lotTicker) return { result: { error: 'Missing ticker' }, success: false };
        const lotQty = Number(toolInput.quantity || 0);
        if (lotQty <= 0) return { result: { error: 'Quantity must be positive' }, success: false };
        const lotFs = (String(toolInput.filing_status || 'single')) as FilingStatus;

        // Fetch positions and trade history for lot reconstruction
        const lotHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };
        const lotBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

        // Get current position for price
        let currentPrice = 0;
        try {
          const posRes = await fetch(`${lotBase}/v2/positions/${lotTicker}`, { headers: lotHeaders, signal: AbortSignal.timeout(10000) });
          if (posRes.ok) {
            const posData = await posRes.json();
            currentPrice = parseFloat(posData.current_price || '0');
          }
        } catch { /* use 0 */ }

        // Reconstruct lots from trade history (buys become lots)
        let lotTrades: TradeRecord[] = [];
        try {
          const since = new Date();
          since.setFullYear(since.getFullYear() - 2);
          const fillsRes = await fetch(
            `${lotBase}/v2/account/activities/FILL?after=${since.toISOString()}&direction=asc&page_size=500`,
            { headers: lotHeaders, signal: AbortSignal.timeout(10000) },
          );
          if (fillsRes.ok) {
            const fills = await fillsRes.json() as Array<{ id: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }>;
            lotTrades = fills
              .filter(f => f.symbol.toUpperCase() === lotTicker.toUpperCase())
              .map(f => ({
                id: f.id,
                ticker: f.symbol,
                action: f.side === 'buy' ? 'buy' as const : 'sell' as const,
                quantity: parseFloat(f.qty),
                price: parseFloat(f.price),
                date: f.transaction_time.split('T')[0],
              }));
          }
        } catch { /* continue */ }

        // Build tax lots from buy history
        const buys = lotTrades.filter(t => t.action === 'buy');
        if (buys.length === 0) {
          return { result: { error: `No buy history found for ${lotTicker}. Cannot reconstruct tax lots.`, disclaimer: TAX_DISCLAIMER }, success: false };
        }

        const taxLots: TaxLot[] = buys.map((b, i) => ({
          id: `LOT-${i + 1}`,
          ticker: b.ticker,
          buyDate: new Date(b.date),
          quantity: b.quantity,
          costBasis: b.price,
          currentPrice,
        }));

        const comparison = compareLotMethods(taxLots, lotQty, { filingStatus: lotFs });
        return { result: { ...comparison, disclaimer: TAX_DISCLAIMER }, success: true };
      }

      case 'get_holding_periods': {
        const hpTicker = toolInput.ticker ? sanitizeSymbol(String(toolInput.ticker)) : null;
        const hpHeaders = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };
        const hpBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

        try {
          const url = hpTicker ? `${hpBase}/v2/positions/${hpTicker}` : `${hpBase}/v2/positions`;
          const posRes = await fetch(url, { headers: hpHeaders, signal: AbortSignal.timeout(10000) });
          if (!posRes.ok) return { result: { error: 'Failed to fetch positions', disclaimer: TAX_DISCLAIMER }, success: false };

          const rawPositions = await posRes.json();
          const posArr = Array.isArray(rawPositions) ? rawPositions : [rawPositions];

          const positions = posArr.map((p: { symbol: string; avg_entry_price: string; current_price: string; qty: string; unrealized_pl: string }) => {
            // Estimate buy date from trade history — fallback to 180 days ago
            const hp = classifyHoldingPeriod(new Date(Date.now() - 180 * 86400000), new Date());
            return {
              symbol: p.symbol,
              avgEntry: parseFloat(p.avg_entry_price),
              currentPrice: parseFloat(p.current_price),
              quantity: parseFloat(p.qty),
              unrealizedPL: parseFloat(p.unrealized_pl),
              daysHeld: hp.daysHeld,
              holdingType: hp.type,
              daysUntilLongTerm: hp.daysUntilLongTerm,
              isApproachingLongTerm: hp.daysUntilLongTerm > 0 && hp.daysUntilLongTerm <= 30,
            };
          });

          const approaching = positions.filter((p: { isApproachingLongTerm: boolean }) => p.isApproachingLongTerm);

          return {
            result: {
              positions,
              total: positions.length,
              approachingLongTerm: approaching.length,
              summary: approaching.length > 0
                ? `${approaching.length} position${approaching.length !== 1 ? 's' : ''} within 30 days of long-term status. Consider holding to qualify for preferential capital gains rates.`
                : 'No positions currently approaching long-term status.',
              disclaimer: TAX_DISCLAIMER,
            },
            success: true,
          };
        } catch (hpErr) {
          const hpMsg = hpErr instanceof Error ? hpErr.message : 'Holding period check failed';
          return { result: { error: hpMsg, disclaimer: TAX_DISCLAIMER }, success: false };
        }
      }

      case 'calculate_section_1256': {
        const s1256Gain = Number(toolInput.total_gain || 0);
        const s1256Income = Number(toolInput.ordinary_income || 0);
        const s1256Fs = (String(toolInput.filing_status || 'single')) as FilingStatus;
        const s1256Result = calculateSection1256Tax(s1256Gain, s1256Income, s1256Fs);
        return {
          result: {
            totalGain: s1256Gain,
            longTermPortion: s1256Result.longTermPortion,
            shortTermPortion: s1256Result.shortTermPortion,
            longTermTax: s1256Result.longTermTax,
            shortTermTax: s1256Result.shortTermTax,
            totalTax: s1256Result.totalTax,
            savingsVsAllShortTerm: s1256Result.savings,
            explanation: s1256Result.savings > 0
              ? `Section 1256 treatment saves $${s1256Result.savings.toLocaleString()} compared to taxing the full gain as short-term. The 60/40 split (60% long-term, 40% short-term) applies automatically to eligible contracts regardless of holding period.`
              : 'No savings from Section 1256 treatment for this scenario.',
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'get_tax_suggestions': {
        const sugFs = (String(toolInput.filing_status || 'single')) as FilingStatus;
        const suggestions: Array<{
          priority: 'high' | 'medium' | 'low';
          category: string;
          title: string;
          description: string;
          potentialSavings?: number;
          deadline?: string;
          actionable: boolean;
        }> = [];

        const now = new Date();
        const month = now.getMonth() + 1; // 1-12

        // 1. Tax-Loss Harvesting — check for losses
        try {
          const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
          const harvestRes = await fetch(`${baseUrl}/api/tax/harvest?filing_status=${sugFs}&min_loss=500`, { signal: AbortSignal.timeout(10000) });
          if (harvestRes.ok) {
            const hd = await harvestRes.json();
            if (hd.data?.candidates?.length > 0) {
              suggestions.push({
                priority: 'high',
                category: 'harvest',
                title: 'Tax-Loss Harvesting Opportunity',
                description: `Found ${hd.data.candidates.length} position(s) with $${Math.abs(hd.data.totalUnrealizedLosses).toLocaleString()} in unrealized losses. Potential tax savings: $${hd.data.totalPotentialSavings.toLocaleString()}.`,
                potentialSavings: hd.data.totalPotentialSavings,
                actionable: true,
              });
            }
          }
        } catch { /* non-blocking */ }

        // 2. Quarterly Estimate reminder
        const quarterlyDates = ACTIVE_TAX_YEAR.estimatedTaxDates;
        for (const [q, dateStr] of Object.entries(quarterlyDates)) {
          const dueDate = new Date(dateStr);
          const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);
          if (daysUntil > 0 && daysUntil <= 30) {
            suggestions.push({
              priority: 'high',
              category: 'quarterly',
              title: `${q.toUpperCase()} Estimated Tax Payment Due`,
              description: `Your quarterly estimated tax payment is due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dateStr}. Use get_tax_estimate to calculate the amount.`,
              deadline: dateStr,
              actionable: true,
            });
          }
        }

        // 3. Year-End Planning (Oct-Dec)
        if (month >= 10) {
          suggestions.push({
            priority: 'high',
            category: 'year_end',
            title: 'Year-End Tax Planning Window',
            description: 'Q4 is the best time to: (1) Accelerate tax losses before year-end, (2) Defer gains into next year if possible, (3) Max out retirement contributions, (4) Review estimated payments to avoid underpayment penalty.',
            actionable: true,
          });
        }

        // 4. Retirement Contributions
        const retLimits = ACTIVE_TAX_YEAR.retirementLimits;
        suggestions.push({
          priority: 'medium',
          category: 'retirement',
          title: 'Maximize Retirement Contributions',
          description: `${now.getFullYear()} limits: Traditional/Roth IRA: $${retLimits.traditional_ira.toLocaleString()}, 401(k): $${retLimits.k401.toLocaleString()}. Maxing your IRA reduces taxable income by $${retLimits.traditional_ira.toLocaleString()}.`,
          potentialSavings: Math.round(retLimits.traditional_ira * 0.24),
          actionable: true,
        });

        // 5. Business Deductions (Glastonbury Group)
        suggestions.push({
          priority: 'medium',
          category: 'business',
          title: 'Business Deduction Review',
          description: `As Glastonbury Group owner, review: Section 179 (up to $${ACTIVE_TAX_YEAR.businessDeductions.section179Limit.toLocaleString()}), home office deduction, vehicle mileage ($${ACTIVE_TAX_YEAR.businessDeductions.mileageRate}/mile), and SEP-IRA contributions (up to $${retLimits.sep_ira_max.toLocaleString()}).`,
          actionable: true,
        });

        // 6. Section 1256 reminder
        suggestions.push({
          priority: 'low',
          category: 'section_1256',
          title: 'Section 1256 Tax Advantage',
          description: 'If you trade futures or broad-based index options, they qualify for 60/40 long-term/short-term treatment regardless of holding period. Use calculate_section_1256 to see potential savings.',
          actionable: true,
        });

        // Sort by priority
        const prioOrder = { high: 0, medium: 1, low: 2 };
        suggestions.sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority]);

        return {
          result: {
            suggestions,
            total: suggestions.length,
            generatedAt: now.toISOString(),
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'export_tax_report': {
        const taxYear = Number(toolInput.tax_year) || new Date().getFullYear();
        const alpacaBase = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
        const alpHdrs = {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || '',
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
        };

        // Fetch 2 years of trades to capture buys before tax year
        const since = new Date(taxYear - 1, 0, 1);
        const tradeRes = await fetch(
          `${alpacaBase}/v2/account/activities/FILL?after=${since.toISOString().split('T')[0]}T00:00:00Z&direction=asc&page_size=1000`,
          { headers: alpHdrs, signal: AbortSignal.timeout(15000) },
        );

        if (!tradeRes.ok) {
          return { result: { error: 'Failed to fetch trade history from Alpaca' }, success: false };
        }

        const rawTrades: Array<{ id: string; activity_type: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }> = await tradeRes.json();
        const allTrades: TradeRecord[] = rawTrades
          .filter(a => a.activity_type === 'FILL')
          .map(a => ({
            id: a.id,
            ticker: a.symbol,
            action: a.side === 'buy' ? 'buy' as const : 'sell' as const,
            quantity: parseFloat(a.qty),
            price: parseFloat(a.price),
            date: a.transaction_time.split('T')[0],
          }));

        const form8949 = generateForm8949Data(allTrades, taxYear);
        const scheduleDSummary = generateScheduleDSummary(form8949);
        const csv = exportForm8949CSV(form8949);

        return {
          result: {
            taxYear,
            totalTrades: form8949.length,
            scheduleDSummary,
            csvPreview: csv.split('\n').slice(0, 6).join('\n') + (form8949.length > 5 ? '\n...' : ''),
            fullCSV: csv,
            message: `Generated Form 8949 report for ${taxYear} with ${form8949.length} trade(s). Schedule D summary: Net ${scheduleDSummary.totalNet >= 0 ? 'gain' : 'loss'} of $${Math.abs(scheduleDSummary.totalNet).toLocaleString()}.${scheduleDSummary.washSaleAdjustments > 0 ? ` Wash sale adjustments: $${scheduleDSummary.washSaleAdjustments.toLocaleString()}.` : ''}`,
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'calculate_business_deductions': {
        const miles = Number(toolInput.miles_driven) || 0;
        const sqft = Number(toolInput.home_office_sqft) || 0;
        const equipment = Number(toolInput.equipment_purchases) || 0;
        const netSE = Number(toolInput.net_self_employment) || 0;
        const bdFs = 'single' as FilingStatus;

        const mileage = calculateMileageDeduction(miles);
        const homeOffice = calculateHomeOfficeDeduction(sqft, 'simplified');
        const sec179 = calculateSection179(equipment);
        const sep = calculateSEPContribution(netSE, bdFs);

        const totalDeductions = mileage.deduction + homeOffice.deduction + sec179.deduction + sep.maxContribution;
        const marginalRate = calculateIncomeTax(
          Math.max(0, netSE - ACTIVE_TAX_YEAR.standardDeduction[bdFs]),
          bdFs,
        ).marginalRate;
        const totalTaxSavings = Math.round(totalDeductions * marginalRate * 100) / 100;

        return {
          result: {
            entity: 'The Glastonbury Group',
            mileage: {
              miles,
              rate: `$${mileage.rate}/mile`,
              deduction: mileage.deduction,
            },
            homeOffice: {
              squareFeet: sqft,
              method: 'simplified',
              deduction: homeOffice.deduction,
              note: sqft > 300 ? 'Simplified method caps at 300 sq ft ($1,500). Regular method may yield higher deduction.' : undefined,
            },
            section179: {
              purchaseAmount: equipment,
              deduction: sec179.deduction,
              phaseout: sec179.phaseout,
              remaining: sec179.remaining,
            },
            sepIRA: {
              netSelfEmployment: netSE,
              maxContribution: sep.maxContribution,
              taxSavings: sep.taxSavings,
            },
            summary: {
              totalDeductions,
              estimatedTaxSavings: totalTaxSavings,
              marginalRate: `${(marginalRate * 100).toFixed(0)}%`,
            },
            disclaimer: TAX_DISCLAIMER,
          },
          success: true,
        };
      }

      case 'order_ticket': {
        const sym = sanitizeSymbol(String(toolInput.ticker ?? ''));
        const side = toolInput.side === 'sell' ? 'sell' : 'buy';
        const qty = Math.max(0, Number(toolInput.qty) || 0);
        const limit = toolInput.limit != null ? Number(toolInput.limit) : null;
        if (!sym || qty <= 0) return { result: { error: 'Need ticker and positive qty' }, success: false };
        // Pull last price for the card
        const { fetchQuote } = await import('@/lib/crew-data');
        const quote = await fetchQuote(sym);
        return {
          result: {
            ticker: sym,
            side,
            qty,
            limit,
            last_price: quote?.price ?? null,
            suggested_sizing: null,
            paperMode: process.env.ALPACA_PAPER === 'true' || (process.env.ALPACA_BASE_URL || '').includes('paper'),
          },
          success: true,
        };
      }

      case 'mini_chart': {
        const sym = sanitizeSymbol(String(toolInput.ticker ?? ''));
        const tf = String(toolInput.timeframe ?? '1M') as '1D'|'5D'|'1M'|'3M'|'6M'|'1Y';
        if (!sym) return { result: { error: 'Need ticker' }, success: false };
        const { fetchBars } = await import('@/lib/crew-data');
        const tfMap: Record<string, { frame: string; limit: number }> = {
          '1D': { frame: '5Min',  limit: 78 },
          '5D': { frame: '30Min', limit: 65 },
          '1M': { frame: '1Day',  limit: 22 },
          '3M': { frame: '1Day',  limit: 65 },
          '6M': { frame: '1Day',  limit: 130 },
          '1Y': { frame: '1Day',  limit: 252 },
        };
        const cfg = tfMap[tf] ?? tfMap['1M'];
        const bars = await fetchBars(sym, cfg.frame, cfg.limit);
        if (bars.length === 0) return { result: { error: 'No bars returned' }, success: false };
        const closes = bars.map(b => b.c);
        const last = closes[closes.length - 1];
        const first = closes[0];
        const change_pct = ((last - first) / first) * 100;
        return { result: { ticker: sym, timeframe: tf, closes, last, change_pct }, success: true };
      }

      case 'greeks_calculator': {
        const { bsPrice, bsDelta, bsGamma, bsTheta, bsVega, bsRho } = await import('@/lib/black-scholes');
        const { fetchQuote } = await import('@/lib/crew-data');
        const sym = sanitizeSymbol(String(toolInput.ticker ?? ''));
        const strike = Number(toolInput.strike);
        const type = toolInput.type === 'put' ? 'put' : 'call';
        const iv = Number(toolInput.iv) > 0 ? Number(toolInput.iv) : 0.30;
        const expiry = String(toolInput.expiry ?? '');
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
      }

      case 'trade_preview': {
        const sym = sanitizeSymbol(String(toolInput.ticker ?? ''));
        const legsRaw = Array.isArray(toolInput.legs) ? toolInput.legs : [];
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
      }

      case 'get_storm_status': {
        const sb = createServiceClient();
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const [{ data: alerts }, { data: territories }] = await Promise.all([
          sb.from('storm_alerts').select('storm_id, storm_name, category, threat_level, impacted_territory_ids, impacted_zips, recommended_long_basket, recommended_short_basket, suggested_sizing_notes, created_at')
            .gte('created_at', since).order('created_at', { ascending: false }).limit(10),
          sb.from('cr3_territories').select('territory_id, county, zip_codes').eq('ar_type', 'Seacoast FL'),
        ]);
        const alertsArr = (alerts as unknown as Array<{ threat_level: string; impacted_territory_ids: string[] }>) ?? [];
        const active = alertsArr.filter(a => a.threat_level !== 'clear');
        return {
          result: {
            active_alert_count: active.length,
            highest_threat: active.length ? active.reduce((acc, a) => ({ clear: 0, watch: 1, warning: 2, direct_hit: 3 } as Record<string, number>)[a.threat_level] > ({ clear: 0, watch: 1, warning: 2, direct_hit: 3 } as Record<string, number>)[acc.threat_level] ? a : acc).threat_level : 'clear',
            alerts: alertsArr.slice(0, 5),
            territory_count: (territories as unknown as unknown[])?.length ?? 0,
            link: '/territories',
          },
          success: true,
        };
      }

      case 'get_tax_harvest_summary': {
        const sb = createServiceClient();
        const week = String(toolInput.week_of ?? '');
        let q = sb.from('tax_harvest_suggestions')
          .select('week_of, position_ticker, unrealized_loss, swap_candidate_ticker, swap_correlation, wash_sale_safe, estimated_tax_savings_usd, status, notes')
          .eq('user_id', 'wes')
          .order('week_of', { ascending: false }).order('unrealized_loss', { ascending: true }).limit(50);
        if (week) q = q.eq('week_of', week);
        const { data } = await q;
        const rows = (data as unknown as Array<{ week_of: string; unrealized_loss: number | null; estimated_tax_savings_usd: number | null; status: string }>) ?? [];
        const latestWeek = rows[0]?.week_of ?? null;
        const thisWeek = rows.filter(r => r.week_of === latestWeek);
        const totalLoss = thisWeek.reduce((s, r) => s + Math.abs(Number(r.unrealized_loss) || 0), 0);
        const totalSavings = thisWeek.reduce((s, r) => s + (Number(r.estimated_tax_savings_usd) || 0), 0);
        return {
          result: {
            week_of: latestWeek,
            suggestion_count: thisWeek.length,
            total_unrealized_loss_scanned: totalLoss,
            total_estimated_tax_savings_usd: totalSavings,
            suggestions: thisWeek.slice(0, 10),
            link: '/tax/harvest/weekly',
          },
          success: true,
        };
      }

      case 'get_coach_review': {
        const sb = createServiceClient();
        const week = String(toolInput.week_of ?? '');
        let q = sb.from('coach_reviews')
          .select('week_of, review_markdown, patterns_detected, primary_rule_for_next_week, trade_count, pnl_usd, created_at')
          .eq('user_id', 'wes')
          .order('week_of', { ascending: false }).limit(1);
        if (week) q = q.eq('week_of', week);
        const { data } = await q;
        const row = (data as unknown as Array<{ week_of: string; review_markdown: string; patterns_detected: unknown; primary_rule_for_next_week: string; trade_count: number | null; pnl_usd: number | null }>)?.[0] ?? null;
        if (!row) return { result: { error: 'No coach reviews yet. Run one at /journal/coach.', link: '/journal/coach' }, success: false };
        return {
          result: {
            week_of: row.week_of,
            primary_rule_for_next_week: row.primary_rule_for_next_week,
            patterns_detected: row.patterns_detected,
            trade_count: row.trade_count,
            pnl_usd: row.pnl_usd,
            review_preview: row.review_markdown?.slice(0, 800),
            link: '/journal/coach',
          },
          success: true,
        };
      }

      case 'get_recent_crew_runs': {
        const sb = createServiceClient();
        const ticker = String(toolInput.ticker ?? '').toUpperCase();
        const limit = Math.max(1, Math.min(20, Number(toolInput.limit ?? 5)));
        let q = sb.from('crew_runs')
          .select('id, ticker, judge_verdict, judge_confidence, judge_rationale, suggested_trade, total_cost_usd, total_latency_ms, created_at')
          .eq('user_id', 'wes').order('created_at', { ascending: false }).limit(limit);
        if (ticker) q = q.eq('ticker', ticker);
        const { data } = await q;
        return {
          result: {
            runs: (data as unknown as Array<Record<string, unknown>>) ?? [],
            filter_ticker: ticker || null,
            link: '/crew',
          },
          success: true,
        };
      }

      case 'get_earnings_memo': {
        const ticker = String(toolInput.ticker ?? '').toUpperCase();
        if (!ticker) return { result: { error: 'Missing ticker' }, success: false };
        const sb = createServiceClient();
        // Find the most recent completed session for this ticker, then its memo
        const { data: sessions } = await sb.from('earnings_sessions')
          .select('id, ticker, quarter, call_date, status, ended_at')
          .eq('user_id', 'wes').eq('ticker', ticker)
          .order('call_date', { ascending: false }).limit(5);
        const sessionRows = (sessions as unknown as Array<{ id: string; ticker: string; quarter: string | null; call_date: string; status: string }>) ?? [];
        if (sessionRows.length === 0) return { result: { error: `No earnings sessions yet for ${ticker}`, link: '/earnings/live' }, success: false };
        const sessionId = sessionRows[0].id;
        const { data: memo } = await sb.from('earnings_memos')
          .select('memo_text, keisha_take, guidance_delta, key_quotes, created_at')
          .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1);
        const memoRow = (memo as unknown as Array<{ memo_text: string; keisha_take: string; guidance_delta: string; key_quotes: unknown }>)?.[0];
        if (!memoRow) return { result: { error: `Session found but no memo yet. Finish the call at /earnings/live/${sessionId}`, link: `/earnings/live/${sessionId}` }, success: false };
        return {
          result: {
            ticker,
            quarter: sessionRows[0].quarter,
            call_date: sessionRows[0].call_date,
            guidance_delta: memoRow.guidance_delta,
            keisha_take: memoRow.keisha_take,
            memo_preview: memoRow.memo_text?.slice(0, 1200),
            key_quotes: memoRow.key_quotes,
            link: `/earnings/live/${sessionId}`,
          },
          success: true,
        };
      }

      case 'get_research_memo': {
        const ticker = String(toolInput.ticker ?? '').toUpperCase();
        const topic = String(toolInput.topic_contains ?? '');
        const sb = createServiceClient();
        let q = sb.from('deep_research_memos')
          .select('id, ticker, topic, memo_markdown, memo_word_count, sources_cited, total_cost_usd, status, created_at')
          .eq('user_id', 'wes').eq('status', 'completed')
          .order('created_at', { ascending: false }).limit(1);
        if (ticker) q = q.eq('ticker', ticker);
        if (topic) q = q.ilike('topic', `%${topic}%`);
        const { data } = await q;
        const row = (data as unknown as Array<{ id: string; ticker: string | null; topic: string; memo_markdown: string; memo_word_count: number | null; sources_cited: unknown }>)?.[0] ?? null;
        if (!row) return { result: { error: 'No matching research memo. Start one at /research', link: '/research' }, success: false };
        return {
          result: {
            id: row.id,
            ticker: row.ticker,
            topic: row.topic,
            word_count: row.memo_word_count,
            source_count: Array.isArray(row.sources_cited) ? row.sources_cited.length : 0,
            memo_preview: row.memo_markdown?.slice(0, 2000),
            link: `/research/${row.id}`,
          },
          success: true,
        };
      }

      case 'get_prediction_markets': {
        const { fetchLatestSnapshots } = await import('@/lib/prediction-markets');
        const category = String(toolInput.category ?? '').toLowerCase();
        const all = await fetchLatestSnapshots();
        const filtered = category
          ? all.filter(s => (s.category ?? '').toLowerCase().includes(category) || s.market_name.toLowerCase().includes(category))
          : all;
        return {
          result: {
            count: filtered.length,
            markets: filtered.slice(0, 12).map(s => ({
              source: s.source,
              ticker: s.market_ticker,
              name: s.market_name,
              yes_pct: s.yes_price != null ? Math.round(s.yes_price * 100) : null,
              delta_24h_pp: s.delta_24h != null ? Math.round(s.delta_24h * 100) : null,
              volume_24h: s.volume_24h,
            })),
            link: '/macro',
          },
          success: true,
        };
      }

      case 'semantic_search': {
        const { semanticSearch } = await import('@/lib/doc-indexer');
        const { isEmbeddingConfigured } = await import('@/lib/embeddings');
        if (!isEmbeddingConfigured().ready) {
          return { result: { error: 'Embeddings not configured. Set VOYAGE_API_KEY or OPENAI_API_KEY.' }, success: false };
        }
        const query = String(toolInput.query ?? '').trim();
        if (!query) return { result: { error: 'Missing query' }, success: false };
        const match_count = Math.max(1, Math.min(20, Number(toolInput.match_count ?? 8)));
        const filter_doc_type = typeof toolInput.filter_doc_type === 'string' ? toolInput.filter_doc_type as import('@/lib/doc-indexer').DocType : null;
        const filter_ticker = typeof toolInput.filter_ticker === 'string' ? toolInput.filter_ticker.toUpperCase() : null;
        const { hits } = await semanticSearch({ query, match_count, filter_ticker, filter_doc_type });
        return {
          result: {
            query,
            filters: { doc_type: filter_doc_type, ticker: filter_ticker },
            hits: hits.map(h => ({
              doc_type: h.doc_type,
              ticker: h.ticker,
              source_id: h.source_id,
              source_url: h.source_url,
              chunk_text: h.chunk_text.length > 600 ? h.chunk_text.slice(0, 600) + '…' : h.chunk_text,
              similarity: Number(h.similarity.toFixed(3)),
            })),
          },
          success: true,
        };
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

    case 'order_ticket':
      return { type: 'order_ticket', data: r as unknown as import('@/types/keisha').OrderTicketCardData };

    case 'mini_chart':
      return { type: 'mini_chart', data: r as unknown as import('@/types/keisha').MiniChartCardData };

    case 'greeks_calculator':
      return { type: 'greeks_calc', data: r as unknown as import('@/types/keisha').GreeksCalcCardData };

    case 'trade_preview':
      return { type: 'trade_preview', data: r as unknown as import('@/types/keisha').TradePreviewCardData };

    default:
      return null;
  }
}
