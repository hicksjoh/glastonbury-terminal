// Thin JSON-RPC 2.0 client for the Command Center MCP server.
//
// The Terminal's MCP tools (server.ts) that start with `empire_*` delegate to
// CC over plain HTTP+JSON. CC is the source of truth for deal pipeline,
// territory status, agent health, and cross-agent memory. Keeping the client
// here (not in each tool) means rotating the CC token or moving CC requires
// changes in one place.
//
// Auth: static bearer token via CC_MCP_TOKEN. CC is a single-tenant private
// server with bearer-only auth — no OAuth dance needed for server-to-server.
//
// Errors: CC_MCP_URL or CC_MCP_TOKEN unset → throw CcMcpUnavailableError so
// callers can surface a clear "command center not configured" message
// instead of a generic network failure.

const DEFAULT_URL = 'https://cc.johnwesleyhicks.com/mcp.php';

export class CcMcpUnavailableError extends Error {
  constructor(reason: string) {
    super(`Command Center MCP unavailable: ${reason}`);
    this.name = 'CcMcpUnavailableError';
  }
}

export class CcMcpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'CcMcpError';
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

let rpcId = 1;

function ccConfig(): { url: string; token: string } {
  const token = process.env.CC_MCP_TOKEN;
  if (!token) throw new CcMcpUnavailableError('CC_MCP_TOKEN env var not set');
  const url = process.env.CC_MCP_URL || DEFAULT_URL;
  return { url, token };
}

async function ccRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { url, token } = ccConfig();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: rpcId++,
    method,
    params,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      // The Bluehost endpoint has a 30s hard timeout; give the client a
      // shorter ceiling so a stuck CC doesn't drag every Terminal call.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new CcMcpUnavailableError(
      `network failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 401) throw new CcMcpError(401, 'CC rejected the MCP token');
  if (!res.ok) throw new CcMcpError(res.status, `CC returned HTTP ${res.status}`);

  const payload = (await res.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new CcMcpError(payload.error.code, payload.error.message);
  }
  if (payload.result === undefined) {
    throw new CcMcpError(-32000, 'CC returned no result');
  }
  return payload.result;
}

/**
 * Call a CC tool by name with structured arguments. Returns the parsed JSON
 * payload the tool emitted (CC tools always emit a single text content item
 * containing JSON). On `isError: true` the response is parsed and returned
 * with an `error` key so callers can distinguish "CC said no" from "CC is
 * down".
 */
export async function callCcTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await ccRpc<ToolCallResult>('tools/call', {
    name: toolName,
    arguments: args,
  });
  const text = result.content?.[0]?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CcMcpError(-32700, `CC tool "${toolName}" returned non-JSON: ${text.slice(0, 200)}`);
  }
  return parsed as T;
}

// ─── Typed wrappers for the 8 tools CC exposes ──────────────────────────

export interface CcDeal {
  id: string;
  prospect: string;
  territory: string;
  stage: string;
  value: number;
  last_activity: string;
  next_action: string;
  score: number;
  created: string;
  notes: string;
}

export interface CcTerritory {
  id: string;
  name: string;
  ar_agreement: string;
  region: string;
  dma: string;
  status: 'available' | 'in_play' | 'sold' | string;
  strategy: string;
  assigned_to: string | null;
  deal_id: string | null;
  key_zips: string[];
}

export interface CcAgentStatus {
  server: string;
  time: string;
  agents: Record<string, { present: boolean; size?: number; modified?: string }>;
}

export interface CcMemoryEntry {
  agent: string;
  key: string;
  value: unknown;
  created_at?: string;
  updated_at?: string;
}

export const cc = {
  getPipeline: (stage?: string) =>
    callCcTool<{ count: number; deals: CcDeal[] }>('cc_get_pipeline', stage ? { stage } : {}),

  getDeal: (deal_id: string) => callCcTool<CcDeal | { error: string }>('cc_get_deal', { deal_id }),

  updateDeal: (input: {
    deal_id: string;
    stage?: string;
    note_append?: string;
    next_action?: string;
    score?: number;
    value?: number;
  }) => callCcTool<{ updated?: string; error?: string }>('cc_update_deal', input),

  logDeal: (input: {
    prospect: string;
    territory?: string;
    stage?: string;
    value?: number;
    next_action?: string;
    notes?: string;
  }) => callCcTool<{ created?: CcDeal; error?: string }>('cc_log_deal', input),

  getTerritories: (filters?: { status?: string; ar_agreement?: string }) =>
    callCcTool<{ count: number; territories: CcTerritory[] }>('cc_get_territories', filters ?? {}),

  getAgentStatus: () => callCcTool<CcAgentStatus>('cc_get_agent_status', {}),

  readMemory: (agent?: string, key?: string, limit?: number) =>
    callCcTool<{ agent: string; key?: string; value?: unknown; count?: number; entries?: CcMemoryEntry[] }>(
      'cc_read_memory',
      { agent: agent ?? 'shared', ...(key ? { key } : {}), ...(limit ? { limit } : {}) },
    ),

  writeMemory: (key: string, value: unknown, agent: string = 'shared') =>
    callCcTool<CcMemoryEntry>('cc_write_memory', { agent, key, value }),
};
