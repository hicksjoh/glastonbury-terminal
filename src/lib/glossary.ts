// ─── Keisha AI Trading Glossary ─────────────────────────────────────────────

export interface GlossaryEntry {
  term: string;
  definition: string;
  whyItMatters: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  'gamma': {
    term: 'Gamma',
    definition: 'The rate of change of an option\'s delta for every $1 move in the underlying stock. It tells you how fast your directional exposure is accelerating.',
    whyItMatters: 'High gamma means your position can swing from profitable to unprofitable very quickly. It\'s the reason near-expiration options are so explosive.',
  },
  'delta': {
    term: 'Delta',
    definition: 'How much an option\'s price moves for every $1 move in the underlying stock. A delta of 0.50 means the option gains $0.50 when the stock goes up $1.',
    whyItMatters: 'Delta is your directional bet. It also roughly estimates the probability an option expires in the money.',
  },
  'theta': {
    term: 'Theta',
    definition: 'The amount an option loses in value each day just from the passage of time, assuming nothing else changes.',
    whyItMatters: 'If you\'re buying options, theta is working against you every single day. If you\'re selling them, it\'s your best friend.',
  },
  'vega': {
    term: 'Vega',
    definition: 'How much an option\'s price changes for every 1% move in implied volatility.',
    whyItMatters: 'Even if the stock moves your way, a drop in IV can destroy your option\'s value. Vega is why buying options before earnings can backfire.',
  },
  'vanna': {
    term: 'Vanna',
    definition: 'The rate of change of delta with respect to changes in implied volatility. It measures how your directional exposure shifts when IV moves.',
    whyItMatters: 'Vanna drives large market moves around volatility events. When IV drops, vanna flows can push stocks higher as dealers adjust hedges.',
  },
  'charm': {
    term: 'Charm (Delta Decay)',
    definition: 'The rate at which delta changes as time passes. It shows how your directional exposure shifts day by day even if the stock doesn\'t move.',
    whyItMatters: 'Charm explains why options that are slightly out of the money lose directional sensitivity faster as expiration approaches.',
  },
  'iv': {
    term: 'IV (Implied Volatility)',
    definition: 'The market\'s forecast of how much a stock is expected to move, expressed as an annualized percentage. It\'s derived from current option prices.',
    whyItMatters: 'IV is the single biggest driver of option prices beyond the stock itself. High IV means expensive options; low IV means cheap ones.',
  },
  'iv_crush': {
    term: 'IV Crush',
    definition: 'A sharp drop in implied volatility that typically happens right after a known event like earnings, FDA decisions, or elections.',
    whyItMatters: 'IV crush can wipe out your gains even if you predicted the stock\'s direction correctly. It\'s the number-one trap for new options traders.',
  },
  'iv_rank': {
    term: 'IV Rank',
    definition: 'Where current IV sits relative to its range over the past year. An IV rank of 80 means IV is near the top of its 52-week range.',
    whyItMatters: 'IV rank helps you decide whether to buy or sell premium. High rank favors selling options; low rank favors buying them.',
  },
  'iv_percentile': {
    term: 'IV Percentile',
    definition: 'The percentage of days in the past year where IV was lower than the current level.',
    whyItMatters: 'IV percentile gives a more nuanced view than IV rank. A 90th percentile means today\'s IV is higher than 90% of the past year\'s readings.',
  },
  'hv': {
    term: 'HV (Historical Volatility)',
    definition: 'How much a stock has actually moved in the past, measured as the standard deviation of returns over a lookback period.',
    whyItMatters: 'Comparing HV to IV tells you if options are cheap or expensive relative to how the stock has actually been moving.',
  },
  'implied_move': {
    term: 'Implied Move',
    definition: 'The expected price range for a stock by a given expiration, derived from option prices. Usually quoted as a plus/minus dollar or percentage amount.',
    whyItMatters: 'The implied move tells you what the market is pricing in. If you think the actual move will be bigger, buy options. Smaller, sell them.',
  },
  'theta_decay': {
    term: 'Theta Decay',
    definition: 'The gradual erosion of an option\'s time value as it approaches expiration. Decay accelerates in the final weeks and days.',
    whyItMatters: 'Theta decay is non-linear -- it speeds up dramatically in the last 30 days. Timing your entry and exit around this curve is critical.',
  },
  'gamma_scalping': {
    term: 'Gamma Scalping',
    definition: 'A strategy where you hold a delta-neutral options position and repeatedly buy or sell the underlying stock to lock in profits as the stock bounces around.',
    whyItMatters: 'Gamma scalping lets you profit from volatility itself rather than picking a direction. It\'s a core market-maker technique.',
  },
  'pin_risk': {
    term: 'Pin Risk',
    definition: 'The risk that a stock closes very near an option\'s strike price at expiration, leaving you uncertain about whether you\'ll be assigned.',
    whyItMatters: 'Pin risk can surprise you with an unexpected stock position over the weekend. Always close or roll near-the-money options before expiration.',
  },
  'max_pain': {
    term: 'Max Pain',
    definition: 'The strike price at which the greatest number of open option contracts would expire worthless, causing maximum combined loss for option holders.',
    whyItMatters: 'Some traders believe stocks are magnetically pulled toward max pain into expiration as market makers manage their books.',
  },
  'open_interest': {
    term: 'Open Interest',
    definition: 'The total number of outstanding option contracts that have been opened but not yet closed, exercised, or expired.',
    whyItMatters: 'High open interest at a strike creates potential support or resistance levels because of the hedging activity it generates.',
  },
  'volume': {
    term: 'Volume',
    definition: 'The number of option contracts traded during a given time period, typically one day.',
    whyItMatters: 'Volume confirms the strength of a price move. A breakout on heavy volume is more trustworthy than one on thin volume.',
  },
  'unusual_activity': {
    term: 'Unusual Activity',
    definition: 'Option trades that are significantly larger than normal for that contract, often flagged when volume exceeds open interest or typical daily averages.',
    whyItMatters: 'Unusual activity can signal that informed money is positioning before a catalyst. It\'s one of the best edge-finding tools available.',
  },
  'sweep': {
    term: 'Sweep',
    definition: 'An aggressive order that hits multiple exchanges simultaneously to fill as quickly as possible, often splitting across price levels.',
    whyItMatters: 'Sweeps signal urgency. When someone sweeps a large options order, they\'re willing to pay up for speed, which suggests conviction.',
  },
  'block_trade': {
    term: 'Block Trade',
    definition: 'A large, privately negotiated trade executed off the public exchange, typically involving 10,000+ shares or a large notional value.',
    whyItMatters: 'Block trades often represent institutional positioning. They can signal where smart money is placing big bets.',
  },
  'dark_pool': {
    term: 'Dark Pool',
    definition: 'A private exchange where large orders are matched anonymously to avoid moving the public market price.',
    whyItMatters: 'Dark pool prints reveal institutional activity that isn\'t visible on the regular tape. Large dark pool buys at key levels can signal hidden support.',
  },
  '0dte': {
    term: '0DTE (Zero Days to Expiration)',
    definition: 'Options that expire on the same day they are traded. They have maximum gamma and zero time value at the open.',
    whyItMatters: '0DTE options offer huge leverage and can move 1000%+ in hours, but they can also go to zero just as fast. They\'re the ultimate high-risk, high-reward instrument.',
  },
  'leaps': {
    term: 'LEAPS (Long-Term Equity Anticipation Securities)',
    definition: 'Options with expiration dates more than one year away. They behave more like stock positions with leverage.',
    whyItMatters: 'LEAPS give you long-term directional exposure with far less capital than buying stock outright, and theta decay is minimal in the early months.',
  },
  'covered_call': {
    term: 'Covered Call',
    definition: 'Selling a call option against shares of stock you already own. You collect premium but cap your upside at the strike price.',
    whyItMatters: 'Covered calls generate income on stocks you hold. It\'s one of the most popular conservative options strategies for building consistent returns.',
  },
  'cash_secured_put': {
    term: 'Cash-Secured Put',
    definition: 'Selling a put option while holding enough cash to buy the stock if assigned. You collect premium while waiting to buy at a lower price.',
    whyItMatters: 'Cash-secured puts let you get paid to wait for your buy price. If the stock drops to your target, you own it at a discount thanks to the premium collected.',
  },
  'iron_condor': {
    term: 'Iron Condor',
    definition: 'A four-leg options strategy that sells both a call spread and a put spread simultaneously, profiting when the stock stays within a defined range.',
    whyItMatters: 'Iron condors profit from time decay and low volatility. They\'re a go-to strategy when you believe a stock will stay range-bound.',
  },
  'butterfly': {
    term: 'Butterfly Spread',
    definition: 'A three-strike options strategy that profits most when the stock closes exactly at the middle strike at expiration. It combines a debit spread with a credit spread.',
    whyItMatters: 'Butterflies offer high reward-to-risk ratios with a defined max loss. They\'re ideal for targeting a specific price at expiration.',
  },
  'straddle': {
    term: 'Straddle',
    definition: 'Buying both a call and a put at the same strike price and expiration. It profits when the stock makes a large move in either direction.',
    whyItMatters: 'Straddles are a pure volatility bet. You\'re saying "I don\'t know which way, but it\'s going to move big." The cost is paying double the premium.',
  },
  'strangle': {
    term: 'Strangle',
    definition: 'Buying a call and a put at different strike prices (typically both out of the money) with the same expiration.',
    whyItMatters: 'Strangles are cheaper than straddles but require a bigger move to profit. They\'re popular before earnings when you expect a large swing but aren\'t sure of the direction.',
  },
  'credit_spread': {
    term: 'Credit Spread',
    definition: 'An options strategy where you sell one option and buy another further out of the money, collecting a net premium (credit) upfront.',
    whyItMatters: 'Credit spreads let you sell premium with defined risk. You profit if the stock stays away from your short strike, making time your ally.',
  },
  'debit_spread': {
    term: 'Debit Spread',
    definition: 'An options strategy where you buy one option and sell another further out of the money, paying a net premium (debit) upfront.',
    whyItMatters: 'Debit spreads reduce the cost of directional bets by sacrificing some upside. They\'re a smarter alternative to buying naked options when IV is high.',
  },
  'collar': {
    term: 'Collar',
    definition: 'A protective strategy that combines owning stock, buying a put for downside protection, and selling a call to offset the put\'s cost.',
    whyItMatters: 'Collars lock in a range of outcomes. They\'re excellent for protecting concentrated stock positions when you can\'t afford a large loss.',
  },
  'wheel_strategy': {
    term: 'Wheel Strategy',
    definition: 'A repeating cycle of selling cash-secured puts until assigned, then selling covered calls until called away, collecting premium at each step.',
    whyItMatters: 'The wheel generates consistent income on stocks you\'re willing to own. It\'s a disciplined system that turns time decay into a paycheck.',
  },
  'assignment': {
    term: 'Assignment',
    definition: 'When the option seller is obligated to fulfill the terms of the contract -- buying stock (put assignment) or selling stock (call assignment).',
    whyItMatters: 'Assignment can happen any time for American-style options, not just at expiration. It changes your capital requirements overnight.',
  },
  'expiration': {
    term: 'Expiration',
    definition: 'The date when an option contract ceases to exist. After this date, the right to buy or sell the underlying stock is gone.',
    whyItMatters: 'Expiration is a hard deadline. Options that are out of the money at expiration expire worthless -- 100% loss of premium paid.',
  },
  'itm': {
    term: 'ITM (In The Money)',
    definition: 'A call option with a strike below the stock price, or a put option with a strike above the stock price. The option has intrinsic value.',
    whyItMatters: 'ITM options have real value and higher deltas, making them behave more like the stock itself. They\'re more expensive but have a higher probability of profit.',
  },
  'otm': {
    term: 'OTM (Out of The Money)',
    definition: 'A call option with a strike above the stock price, or a put option with a strike below the stock price. The option has no intrinsic value.',
    whyItMatters: 'OTM options are cheaper and offer more leverage, but they need the stock to move significantly to be profitable. Most OTM options expire worthless.',
  },
  'atm': {
    term: 'ATM (At The Money)',
    definition: 'An option with a strike price equal to or very close to the current stock price.',
    whyItMatters: 'ATM options have the highest time value and roughly 50 delta, making them the most sensitive to both price movement and implied volatility changes.',
  },
  'roll': {
    term: 'Roll',
    definition: 'Closing an existing option position and simultaneously opening a new one with a different strike, expiration, or both.',
    whyItMatters: 'Rolling lets you manage a losing trade or extend a winning one without closing the position entirely. It\'s a key tool for active options management.',
  },
  'breakeven': {
    term: 'Breakeven',
    definition: 'The stock price at which an option trade neither makes nor loses money at expiration, factoring in the premium paid or received.',
    whyItMatters: 'Knowing your breakeven before entering a trade sets clear expectations. If the stock can\'t reasonably reach breakeven, the trade isn\'t worth taking.',
  },
  'risk_reward': {
    term: 'Risk/Reward Ratio',
    definition: 'The relationship between the maximum potential loss and the maximum potential gain of a trade.',
    whyItMatters: 'A good risk/reward ratio means you don\'t have to be right most of the time to be profitable. Even a 40% win rate can make money with 3:1 risk/reward.',
  },
  'sharpe_ratio': {
    term: 'Sharpe Ratio',
    definition: 'A measure of risk-adjusted return that divides excess return (above the risk-free rate) by the standard deviation of returns.',
    whyItMatters: 'A Sharpe ratio above 1.0 is decent, above 2.0 is excellent. It tells you whether your returns are coming from skill or just taking on more risk.',
  },
  'sortino_ratio': {
    term: 'Sortino Ratio',
    definition: 'Similar to the Sharpe ratio but only penalizes downside volatility, ignoring upside swings.',
    whyItMatters: 'Sortino is a more realistic measure of risk because big gains shouldn\'t count against you. A high Sortino means your strategy avoids drawdowns well.',
  },
  'beta': {
    term: 'Beta',
    definition: 'How much a stock moves relative to the overall market. A beta of 1.5 means the stock moves 50% more than the S&P 500 on average.',
    whyItMatters: 'Beta helps you size positions and understand portfolio risk. High-beta stocks amplify both gains and losses relative to the market.',
  },
  'alpha': {
    term: 'Alpha',
    definition: 'The excess return of an investment relative to a benchmark index, after adjusting for risk.',
    whyItMatters: 'Alpha is the whole game. It measures whether your strategy is actually adding value beyond what you\'d get from just buying an index fund.',
  },
  'r_squared': {
    term: 'R-Squared',
    definition: 'A statistical measure (0-100) showing how closely a portfolio\'s returns track a benchmark index.',
    whyItMatters: 'Low R-squared means your returns aren\'t just following the market. High R-squared with no alpha means you should probably buy the index instead.',
  },
  'drawdown': {
    term: 'Drawdown',
    definition: 'The peak-to-trough decline in a portfolio\'s value before a new high is reached, expressed as a percentage.',
    whyItMatters: 'Max drawdown shows your worst-case scenario. A 50% drawdown requires a 100% gain just to get back to even, which is why capital preservation matters.',
  },
  'vix': {
    term: 'VIX (Volatility Index)',
    definition: 'The CBOE\'s measure of expected 30-day volatility in the S&P 500, derived from option prices. Often called the "fear gauge."',
    whyItMatters: 'VIX above 20 signals elevated fear; above 30 is panic territory. It drives option premiums across the entire market.',
  },
  'skew': {
    term: 'Skew',
    definition: 'The difference in implied volatility between out-of-the-money puts and out-of-the-money calls. Higher put IV relative to call IV means negative skew.',
    whyItMatters: 'Skew reveals how much the market is willing to pay for downside protection versus upside speculation. Extreme skew often precedes large moves.',
  },
  'term_structure': {
    term: 'Term Structure',
    definition: 'The pattern of implied volatility across different expiration dates for the same underlying asset.',
    whyItMatters: 'A normal term structure (upward sloping) means the market is calm. An inverted one (near-term IV higher) signals an imminent event or fear.',
  },
  'vol_surface': {
    term: 'Volatility Surface',
    definition: 'A 3D visualization of implied volatility across both strike prices and expiration dates, showing the complete IV landscape for an asset.',
    whyItMatters: 'The vol surface reveals mispricings and opportunities. Experienced traders scan it to find strikes and expirations where IV looks cheap or rich.',
  },
  'rsi': {
    term: 'RSI (Relative Strength Index)',
    definition: 'A momentum oscillator that measures the speed and magnitude of recent price changes on a 0-100 scale. Above 70 is overbought; below 30 is oversold.',
    whyItMatters: 'RSI helps you avoid chasing extended moves. Buying when RSI is already at 80 means you\'re late to the party.',
  },
  'macd': {
    term: 'MACD (Moving Average Convergence Divergence)',
    definition: 'A trend-following indicator that shows the relationship between two moving averages (typically 12-day and 26-day EMA). Signal crossovers indicate momentum shifts.',
    whyItMatters: 'MACD crossovers can confirm trend changes early. When MACD crosses above its signal line, bullish momentum is building.',
  },
  'bollinger_bands': {
    term: 'Bollinger Bands',
    definition: 'A volatility indicator with three lines: a middle moving average and upper/lower bands set at 2 standard deviations above and below it.',
    whyItMatters: 'Price touching the upper band doesn\'t mean "sell" -- it means volatility is expanding. Squeezing bands often precede explosive moves.',
  },
  'support': {
    term: 'Support',
    definition: 'A price level where buying pressure has historically been strong enough to prevent the stock from falling further.',
    whyItMatters: 'Support levels are where buyers step in. A break below support can trigger stop-losses and accelerate the sell-off.',
  },
  'resistance': {
    term: 'Resistance',
    definition: 'A price level where selling pressure has historically been strong enough to prevent the stock from rising further.',
    whyItMatters: 'Resistance is where sellers defend. A breakout above resistance with volume often signals the start of a new leg higher.',
  },
  'moving_average': {
    term: 'Moving Average',
    definition: 'The average closing price over a set number of periods, creating a smoothed line that shows the trend direction.',
    whyItMatters: 'Moving averages filter out noise. The 50-day and 200-day MAs are watched by nearly everyone, making them self-fulfilling support and resistance levels.',
  },
  'ema': {
    term: 'EMA (Exponential Moving Average)',
    definition: 'A moving average that gives more weight to recent prices, making it more responsive to new information than a simple moving average.',
    whyItMatters: 'EMAs react faster to price changes, which helps you catch trend shifts earlier. The 9 and 21 EMA are popular for short-term trading.',
  },
  'sma': {
    term: 'SMA (Simple Moving Average)',
    definition: 'A moving average that weights all prices equally over the lookback period.',
    whyItMatters: 'SMA is smoother and less prone to whipsaws than EMA. The 200-day SMA is the most-watched level in all of technical analysis.',
  },
  'vwap': {
    term: 'VWAP (Volume-Weighted Average Price)',
    definition: 'The average price a stock has traded at throughout the day, weighted by volume at each price level.',
    whyItMatters: 'Institutional traders use VWAP as their benchmark. Price above VWAP means buyers are in control; below means sellers are winning.',
  },
  'gap_up': {
    term: 'Gap Up',
    definition: 'When a stock opens significantly higher than its previous close, creating a visible gap on the chart with no trades in between.',
    whyItMatters: 'Gap ups on news or earnings can signal strong buying conviction. Whether the gap fills or holds often determines the day\'s direction.',
  },
  'gap_down': {
    term: 'Gap Down',
    definition: 'When a stock opens significantly lower than its previous close, creating a visible gap on the chart.',
    whyItMatters: 'Gap downs can be panic-driven selling opportunities or signs of real trouble. Context matters -- earnings misses gap differently than sector rotation.',
  },
  'gex': {
    term: 'GEX (Gamma Exposure)',
    definition: 'Measures how much market makers need to buy or sell stock to stay hedged as prices move.',
    whyItMatters: 'When GEX is positive, market makers cushion price moves (less volatile). When negative, they amplify moves (more volatile).',
  },
};

/**
 * Returns all glossary keys for matching (lowercase).
 */
export function getGlossaryKeys(): string[] {
  return Object.keys(GLOSSARY);
}
