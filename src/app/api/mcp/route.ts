import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildTerminalMcpServer } from '@/lib/mcp/server';

// F1 — MCP streamable-HTTP transport.
//
// This route is the endpoint MCP clients (Claude.app remote MCP,
// Claude Desktop via a local proxy, custom scripts) talk to. It
// authenticates via a bearer token distinct from the gt-auth cookie,
// then hands the Request off to the MCP SDK's web-standard transport.
//
// Why stateless mode: Vercel serverless invocations don't share state
// across requests, so session-aware transport would need external storage
// and doesn't buy us anything for the MVP. The SDK handles this via
// `sessionIdGenerator: undefined`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${expected}`) return true;
  if (req.headers.get('x-api-key') === expected) return true;
  return false;
}

async function handle(req: NextRequest): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const server = buildTerminalMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    // Convert NextRequest to a standard fetch Request so the transport can
    // consume it. NextRequest is already Request-compatible for header +
    // method + body reads, so we can pass through.
    const response = await transport.handleRequest(req as unknown as Request);
    return response;
  } finally {
    // The transport owns the server after connect(); closing the transport
    // is the graceful shutdown path. In stateless serverless we could let
    // GC handle it, but being explicit avoids leaks in long-lived tests.
    transport.close().catch(() => {});
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
