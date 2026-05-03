import { z } from 'zod';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDef } from './registry';
import { sanitizeSymbol } from '@/lib/sanitize';
import type { OptionsCardData } from '@/types/keisha';

const inputSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  type: z.enum(['call', 'put']).optional().describe('Filter by option type (default: both)'),
});

export const lookupOptions: ToolDef<z.infer<typeof inputSchema>> = {
  name: 'lookup_options',
  description: 'Look up options chain data for a symbol. Returns the nearest expirations with strikes around the current price, including bid, ask, IV, delta, and open interest. Use when Wes asks about options, premiums, covered calls, or Greeks.',
  inputSchema,
  toAnthropicTool: (): Tool => ({
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
  }),
  async execute(input) {
    const symbol = sanitizeSymbol(String(input.symbol || ''));
    if (!symbol) return { result: { error: 'Missing symbol' }, success: false };

    const optionType = input.type as 'call' | 'put' | undefined;

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
  },
  buildRenderCard(input, result, success) {
    if (!success || !result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
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
        symbol: String(r.symbol || input.symbol || ''),
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
  },
};
