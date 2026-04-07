export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  tool?: string;
  parseArgs: (args: string[]) => Record<string, unknown>;
}

export const SLASH_COMMANDS: Record<string, SlashCommand> = {
  '/price': {
    name: 'Price Lookup',
    description: 'Get current price for a symbol',
    usage: '/price NVDA',
    tool: 'lookup_price',
    parseArgs: (args) => ({ symbol: args[0]?.toUpperCase() || '' }),
  },
  '/prices': {
    name: 'Batch Price Lookup',
    description: 'Get prices for multiple symbols',
    usage: '/prices NVDA TSLA AAPL',
    tool: 'batch_lookup',
    parseArgs: (args) => ({ symbols: args.map(s => s.toUpperCase()) }),
  },
  '/scan': {
    name: 'Watchlist Scan',
    description: 'Scan watchlist for top opportunities',
    usage: '/scan or /scan 5',
    tool: 'scan_watchlist',
    parseArgs: (args) => ({ limit: parseInt(args[0]) || 3 }),
  },
  '/positions': {
    name: 'Portfolio Summary',
    description: 'Get portfolio overview',
    usage: '/positions',
    tool: 'portfolio_summary',
    parseArgs: () => ({}),
  },
  '/options': {
    name: 'Options Chain',
    description: 'Look up options chain',
    usage: '/options NVDA or /options NVDA call',
    tool: 'lookup_options',
    parseArgs: (args) => ({ symbol: args[0]?.toUpperCase() || '', type: args[1]?.toLowerCase() }),
  },
  '/brief': {
    name: 'Morning Briefing',
    description: 'Generate market briefing',
    usage: '/brief',
    parseArgs: () => ({}),
  },
  '/export': {
    name: 'Export Chat',
    description: 'Export conversation as markdown',
    usage: '/export',
    parseArgs: () => ({}),
  },
  '/remember': {
    name: 'Pin Memory',
    description: 'Save a note for Keisha to remember',
    usage: '/remember bearish on TSLA until Q2',
    tool: 'pin_memory',
    parseArgs: (args) => ({ content: args.join(' ') }),
  },
  '/memories': {
    name: 'Recall Memories',
    description: 'View saved memory pins',
    usage: '/memories or /memories TSLA',
    tool: 'recall_memories',
    parseArgs: (args) => args.length > 0 ? { symbol: args[0]?.toUpperCase() } : {},
  },
  '/help': {
    name: 'Help',
    description: 'Show available commands',
    usage: '/help',
    parseArgs: () => ({}),
  },
};

export function parseSlashCommand(input: string): { command: SlashCommand; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const cmdKey = parts[0].toLowerCase();
  const command = SLASH_COMMANDS[cmdKey];
  if (!command) return null;

  return { command, args: parts.slice(1) };
}

export function getMatchingCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const prefix = input.split(/\s/)[0].toLowerCase();
  return Object.entries(SLASH_COMMANDS)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, cmd]) => cmd);
}
