export interface SidebarDescription {
  title: string;
  description: string;
}

export const SECTION_DESCRIPTIONS: Record<string, SidebarDescription> = {
  MARKETS: {
    title: 'Markets',
    description: 'Real-time market data, news, watchlists, sector performance, and economic calendar. Your window into what\'s happening right now.',
  },
  TRADING: {
    title: 'Trading',
    description: 'Execute trades, screen for setups, build strategies, backtest ideas, and journal your trades. Your active trading workspace.',
  },
  EMPIRE: {
    title: 'Empire',
    description: 'Track your CR3 franchise territories, monitor cash flow across all revenue streams, and manage tax strategy. Your business command center.',
  },
  'QUANT LAB': {
    title: 'Quant Lab',
    description: 'Advanced quantitative tools — gamma exposure, volatility surfaces, pairs trading, regime detection, and portfolio optimization. Where math meets money.',
  },
  'ALPHA ENGINE': {
    title: 'Alpha Engine',
    description: 'Signal detection, unusual options flow, insider activity, earnings intelligence, and P&L simulation. Your edge-finding toolkit.',
  },
  INTELLIGENCE: {
    title: 'Intelligence',
    description: 'Risk analysis, Monte Carlo simulations, smart alerts, and Keisha AI. Your strategic brain.',
  },
};

export const PAGE_DESCRIPTIONS: Record<string, SidebarDescription> = {
  '/': { title: 'Dashboard', description: 'Portfolio snapshot, market overview, top movers, and today\'s key events at a glance.' },
  '/wealth': { title: 'Wealth', description: 'Total net worth tracking, asset allocation breakdown, and long-term wealth metrics across all accounts.' },
  '/news': { title: 'News', description: 'Real-time financial news with AI sentiment scoring. Headlines filtered by relevance to your portfolio.' },
  '/watchlist': { title: 'Watchlist', description: 'Your curated stocks to monitor. Live prices, daily changes, sparklines, and quick-action buttons.' },
  '/sectors': { title: 'Sectors', description: 'Sector rotation heatmap. See which sectors are leading or lagging and spot rotation opportunities.' },
  '/calendar': { title: 'Calendar', description: 'Economic calendar + earnings dates + options expirations. Know what events could move your positions.' },
  '/trading': { title: 'Trading', description: 'Place orders, manage open positions, and track order status. Your live trading cockpit.' },
  '/trading/options/screener': { title: 'Options Screener', description: 'Filter options by Greeks, IV rank, volume, and strategy type. Find the best setups fast.' },
  '/screener': { title: 'Stock Screener', description: 'Screen stocks by technicals, fundamentals, and custom criteria. Build scans for exactly what you need.' },
  '/strategies': { title: 'Strategies', description: 'Define and manage multi-leg trading strategies. Build spreads, condors, and custom combos with risk visualization.' },
  '/backtest': { title: 'Backtest', description: 'Test strategies against historical data before risking real money. See how ideas would have performed.' },
  '/journal': { title: 'Journal', description: 'Trade journal with AI analysis. Log trades, track emotions, and let Keisha spot patterns in your wins and losses.' },
  '/territories': { title: 'Territories', description: 'CR3 franchise territory map. Track all 23 territories across Seacoast FL and West Coast FL agreements.' },
  '/cashflow': { title: 'Cash Flow', description: 'Revenue tracking — franchise fees, AR royalties, equity, and events. Money in and money out.' },
  '/tax': { title: 'Tax Center', description: 'Real-time capital gains tracking, wash sale monitoring, tax-loss harvesting, bracket visualizer, estimated quarterly tax calculations, and Section 1256 optimizer.' },
  '/scanner': { title: 'Signal Scanner', description: 'Real-time signal detection combining technicals, flow, and sentiment. Signals scored by strength.' },
  '/flow': { title: 'Options Flow', description: 'Live unusual options activity. See what smart money is betting on — large sweeps, blocks, and aggressive orders.' },
  '/insider': { title: 'Insider Tracker', description: 'SEC Form 4 insider buys and sells. Cluster buys (3+ insiders) are the strongest bullish signal in the market.' },
  '/earnings': { title: 'Earnings Intel', description: 'Upcoming earnings with AI-predicted surprise direction, historical reactions, and implied move analysis.' },
  '/simulator': { title: 'P&L Simulator', description: 'Model "what if" scenarios. Simulate crashes, rotations, and rate changes to see your exposure.' },
  '/gex': { title: 'GEX Levels', description: 'Gamma Exposure analysis — see where market makers are positioned. When GEX flips negative, volatility explodes.' },
  '/vol-surface': { title: 'Vol Surface', description: '3D implied volatility surface. Spot mispriced options by comparing implied vs historical vol across strikes.' },
  '/pairs': { title: 'Pairs Trading', description: 'Find correlated stocks that diverged. Statistical arbitrage — profit when the spread reverts.' },
  '/drift': { title: 'Drift Regime', description: 'Trending or mean-reverting? Different strategies work in different regimes — trade accordingly.' },
  '/macro': { title: 'Macro Regime', description: 'Global macro analysis — growth vs recession, inflation vs deflation, risk-on vs risk-off. The big picture.' },
  '/optimizer': { title: 'Optimizer', description: 'Portfolio optimization — risk parity, Black-Litterman, efficient frontier. The mathematically optimal allocation.' },
  '/crew': { title: 'Trading Crew', description: 'Multi-agent AI system — specialist agents debate trade ideas and reach consensus. Your AI trading floor.' },
  '/autopilot': { title: 'Auto-Pilot', description: 'Automated strategy execution with guardrails. Set rules, define risk limits, let the system work while you sleep.' },
  '/risk': { title: 'Risk', description: 'Portfolio risk — VaR, beta exposure, sector concentration, correlation matrix, drawdown analysis. Know your risk.' },
  '/monte-carlo': { title: 'Monte Carlo', description: 'Thousands of simulated scenarios to see the probability distribution of your portfolio outcomes.' },
  '/alerts': { title: 'Alerts', description: 'Smart alerts — volatility spikes, flow anomalies, regime changes, GEX flips, behavioral triggers.' },
  '/keisha': { title: 'Keisha AI', description: 'Your personal AI wealth strategist. Ask anything, get trade ideas, run analysis, get plain-English explanations.' },
  '/guard-test': { title: 'Guard Test', description: 'Test the Behavioral Trading Guard. Simulate emotional scenarios to calibrate before real money is at stake.' },
  '/congress': { title: 'Congress', description: 'Track what Congress members are buying and selling. Politicians\' trades are public record — and historically beat the market.' },
  '/settings': { title: 'Settings', description: 'Configure alert thresholds, API keys, display preferences, and notification settings.' },
};
