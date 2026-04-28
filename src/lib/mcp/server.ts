// F1 — MCP (Model Context Protocol) server factory.
//
// Exposes a curated slice of the Glastonbury Terminal to any MCP client
// (Claude.app remote MCP, Claude Desktop via a local proxy, custom scripts).
// Claude can now ask "what's my portfolio worth?" or "add NVDA to my
// watchlist" from outside the terminal and get real answers routed through
// this server.
//
// Auth: the transport layer (src/app/api/mcp/route.ts) requires a bearer
// token matching MCP_AUTH_TOKEN. This module does not duplicate the check.
//
// Tool catalog is intentionally small for the MVP — five essential tools
// covering portfolio read, watchlist read/write, briefing read, and
// cross-agent memory read/write. More tools can be added here without
// touching the transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAccount, getPositions } from '@/lib/alpaca';
import { createServiceClient } from '@/lib/supabase';
import {
  setMemory,
  getMemory,
  listMemory,
  type AgentName,
} from '@/lib/agent-memory';

const SERVER_INFO = {
  name: 'glastonbury-terminal',
  version: '1.0.0',
} as const;

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function okJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}

export function buildTerminalMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  // ─── tool: terminal_get_portfolio ──────────────────────────────────
  server.tool(
    'terminal_get_portfolio',
    'Returns the live Alpaca account snapshot (equity, cash, day P&L) plus open positions and a wealth summary across CR3 franchise + RSUs + real estate. Use this when asked about net worth, P&L, positions, or portfolio value.',
    {},
    async () => {
      try {
        const [account, positions] = await Promise.all([
          getAccount().catch(() => null),
          getPositions().catch(() => []),
        ]);
        const equity = account ? parseFloat(account.equity) : 0;
        const lastEquity = account ? parseFloat(account.last_equity) : equity;
        const dayPL = equity - lastEquity;
        const positionArr = Array.isArray(positions) ? positions : [];

        const supabase = createServiceClient();
        const { data: wealthAssets } = await supabase
          .from('wealth_assets')
          .select('asset_class, current_value');
        const byClass: Record<string, number> = {};
        for (const a of wealthAssets ?? []) {
          const row = a as { asset_class: string; current_value: string | number };
          byClass[row.asset_class] =
            (byClass[row.asset_class] ?? 0) + Number(row.current_value);
        }

        return okJson({
          brokerage: {
            equity,
            cash: account ? parseFloat(account.cash) : 0,
            day_pl: dayPL,
            day_pct: lastEquity > 0 ? (dayPL / lastEquity) * 100 : 0,
            positions: positionArr.map((p: Record<string, string>) => ({
              symbol: p.symbol,
              qty: parseFloat(p.qty),
              market_value: parseFloat(p.market_value),
              unrealized_pl: parseFloat(p.unrealized_pl),
              unrealized_plpc: parseFloat(p.unrealized_plpc),
            })),
          },
          wealth_summary: byClass,
          net_worth_estimate:
            equity + Object.values(byClass).reduce((s, v) => s + v, 0),
        });
      } catch (err) {
        return fail(`terminal_get_portfolio failed: ${(err as Error).message}`);
      }
    },
  );

  // ─── tool: terminal_get_watchlist ──────────────────────────────────
  server.tool(
    'terminal_get_watchlist',
    'Returns the current watchlist symbols with optional notes and last known price. Use when asked what Wes is watching, tracking, or following.',
    {},
    async () => {
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from('watchlist')
          .select('symbol, company_name, current_price, notes, created_at')
          .order('created_at', { ascending: false });
        if (error) return fail(`watchlist query failed: ${error.message}`);
        return okJson({ count: data?.length ?? 0, items: data ?? [] });
      } catch (err) {
        return fail(`terminal_get_watchlist failed: ${(err as Error).message}`);
      }
    },
  );

  // ─── tool: terminal_add_to_watchlist ───────────────────────────────
  server.tool(
    'terminal_add_to_watchlist',
    'Add a stock symbol to the watchlist. Symbol is uppercased automatically. Returns the inserted row (or an error if the symbol already exists).',
    {
      symbol: z.string().min(1).max(10).describe('Ticker symbol (e.g., "NVDA")'),
      notes: z.string().optional().describe('Optional free-form note about why'),
    },
    async ({ symbol, notes }) => {
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from('watchlist')
          .insert({
            symbol: symbol.toUpperCase(),
            notes: notes ?? null,
          })
          .select()
          .single();
        if (error) return fail(`watchlist insert failed: ${error.message}`);
        return okJson({ added: data });
      } catch (err) {
        return fail(`terminal_add_to_watchlist failed: ${(err as Error).message}`);
      }
    },
  );

  // ─── tool: terminal_get_latest_briefing ────────────────────────────
  server.tool(
    'terminal_get_latest_briefing',
    'Returns the most recent Keisha morning briefing with its portfolio + market data context. Use this when asked "what did the briefing say" or for a morning recap.',
    {},
    async () => {
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from('briefings')
          .select('id, content, market_data_json, portfolio_data_json, created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return fail(`briefings query failed: ${error.message}`);
        if (!data) return ok('No briefing available yet.');
        return okJson(data);
      } catch (err) {
        return fail(`terminal_get_latest_briefing failed: ${(err as Error).message}`);
      }
    },
  );

  // ─── tool: terminal_read_memory ────────────────────────────────────
  server.tool(
    'terminal_read_memory',
    'Read cross-agent shared memory. Pass agent="shared" for the default pool, or a specific agent name (e.g., "keisha"). If `key` is provided, returns the single value; otherwise returns the newest entries for that agent.',
    {
      agent: z.string().default('shared').describe('Agent namespace (e.g., "shared", "keisha", "apollo")'),
      key: z.string().optional().describe('Exact key to fetch. Omit to list.'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max entries to list when `key` is omitted.'),
    },
    async ({ agent, key, limit }) => {
      try {
        if (key) {
          const value = await getMemory(agent as AgentName, key);
          return okJson({ agent, key, value });
        }
        const rows = await listMemory(agent as AgentName, limit);
        return okJson({ agent, count: rows.length, entries: rows });
      } catch (err) {
        return fail(`terminal_read_memory failed: ${(err as Error).message}`);
      }
    },
  );

  // ─── tool: terminal_write_memory ───────────────────────────────────
  server.tool(
    'terminal_write_memory',
    'Write a fact into cross-agent shared memory. Upserts on (agent, key). The value should be a short structured JSON object or string. Use agent="shared" by default so other agents can read it.',
    {
      agent: z.string().default('shared').describe('Agent namespace to write into'),
      key: z.string().min(1).describe('Stable key identifying this fact'),
      value: z.any().describe('The value to store (string, number, object — anything JSON-serializable)'),
      ttl_ms: z.number().int().min(1_000).optional().describe('Optional TTL in milliseconds after which this fact is auto-pruned'),
    },
    async ({ agent, key, value, ttl_ms }) => {
      try {
        const rec = await setMemory(agent as AgentName, key, value, {
          ttlMs: ttl_ms,
        });
        if (!rec) return fail('Memory write failed (Supabase not configured?)');
        return okJson({
          agent: rec.agent_name,
          key: rec.key,
          value: rec.value,
          updated_at: rec.updated_at,
        });
      } catch (err) {
        return fail(`terminal_write_memory failed: ${(err as Error).message}`);
      }
    },
  );

  return server;
}
