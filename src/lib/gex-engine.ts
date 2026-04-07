// ─── Shared GEX Analysis Runner ─────────────────────────────────────────────

export interface GEXAnalysisResult {
  symbol: string;
  spotPrice: number;
  netGEX: number;
  regime: 'positive' | 'negative';
  impact: string;
  levels: {
    putWall: number;
    callWall: number;
    hvl: number;
    gammaFlip: number;
    pinStrikes: number[];
  };
  dataSource: string;
}

/** Black-Scholes-style gamma approximation for ATM options */
function syntheticGamma(spot: number, strike: number, dte: number): number {
  const t = Math.max(dte / 365, 0.001);
  const sigma = 0.2;
  const d1Num = Math.log(spot / strike) + 0.5 * sigma * sigma * t;
  const d1 = d1Num / (sigma * Math.sqrt(t));
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (spot * sigma * Math.sqrt(t));
}

/** Generate synthetic chain when real data unavailable */
function generateSyntheticChain(spot: number, symbol: string): OptionsChainItem[] {
  const chain: OptionsChainItem[] = [];
  const today = new Date();

  const expirations: string[] = [];
  const fri1 = new Date(today);
  fri1.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
  expirations.push(fri1.toISOString().split('T')[0]);
  const fri2 = new Date(fri1);
  fri2.setDate(fri1.getDate() + 7);
  expirations.push(fri2.toISOString().split('T')[0]);
  const monthly = new Date(today);
  monthly.setDate(today.getDate() + 30);
  expirations.push(monthly.toISOString().split('T')[0]);

  const spacing = spot > 400 ? 5 : spot > 100 ? 2 : spot > 50 ? 1 : 0.5;
  const range = spot * 0.1;
  const lowStrike = Math.floor((spot - range) / spacing) * spacing;
  const highStrike = Math.ceil((spot + range) / spacing) * spacing;

  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i) * (i + 1);
  const seededRandom = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 0x7fffffff;
  };

  for (const exp of expirations) {
    const dte = Math.max(1, Math.round((new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    for (let strike = lowStrike; strike <= highStrike; strike += spacing) {
      const gamma = syntheticGamma(spot, strike, dte);
      const moneyness = Math.abs(spot - strike) / spot;
      const atmFactor = Math.exp(-moneyness * moneyness * 200);
      const roundBonus = strike % (spacing * 10) === 0 ? 1.8 : 1;
      const baseOI = 2000 + seededRandom() * 8000;

      chain.push({
        strike: Math.round(strike * 100) / 100,
        expiration: exp,
        callOI: Math.round(baseOI * atmFactor * roundBonus * (1 + seededRandom() * 0.5)),
        putOI: Math.round(baseOI * atmFactor * roundBonus * (1 + seededRandom() * 0.5)),
        callGamma: Math.round(gamma * (1 + (seededRandom() - 0.5) * 0.1) * 1e8) / 1e8,
        putGamma: Math.round(gamma * (1 + (seededRandom() - 0.5) * 0.1) * 1e8) / 1e8,
        callVolume: Math.round(baseOI * atmFactor * (0.05 + seededRandom() * 0.15)),
        putVolume: Math.round(baseOI * atmFactor * (0.05 + seededRandom() * 0.15)),
      });
    }
  }
  return chain;
}

/**
 * Run full GEX analysis for a symbol.
 * Fetches spot price from Alpaca, tries real options chain, falls back to synthetic.
 */
export async function runGEXAnalysis(symbol: string): Promise<GEXAnalysisResult> {
  const alpacaHeaders = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || process.env.APCA_API_SECRET_KEY || '',
  };

  // 1. Get spot price
  let spotPrice = 0;
  try {
    const snapRes = await fetch(
      `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot`,
      { headers: alpacaHeaders },
    );
    if (snapRes.ok) {
      const snap = await snapRes.json();
      spotPrice = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
    }
  } catch { /* fallback below */ }

  if (spotPrice === 0) {
    const fmpKey = process.env.FMP_API_KEY || '';
    if (fmpKey) {
      try {
        const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpKey}`);
        const data = await res.json();
        if (Array.isArray(data) && data[0]) spotPrice = data[0].price || 0;
      } catch { /* use default */ }
    }
  }

  if (spotPrice === 0) {
    const defaults: Record<string, number> = { SPY: 570, QQQ: 480, IWM: 210, AAPL: 230, TSLA: 270, NVDA: 120, AMZN: 200, MSFT: 420 };
    spotPrice = defaults[symbol] || 100;
  }

  // 2. Try real Alpaca options chain
  let chain: OptionsChainItem[] | null = null;
  let dataSource = 'synthetic';

  try {
    const url = `https://data.alpaca.markets/v1beta1/options/snapshots/${symbol}?feed=indicative`;
    const res = await fetch(url, { headers: alpacaHeaders });
    if (res.ok) {
      const data = await res.json();
      if (data.snapshots && typeof data.snapshots === 'object') {
        const realChain: OptionsChainItem[] = [];
        const grouped = new Map<string, OptionsChainItem>();

        for (const [contractSymbol, snap] of Object.entries(data.snapshots) as [string, any][]) {
          const match = contractSymbol.match(/([A-Z]+)\s*(\d{6})([CP])(\d{8})/);
          if (!match) continue;
          const exp = `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`;
          const optType = match[3];
          const strike = parseInt(match[4], 10) / 1000;
          const key = `${strike}-${exp}`;

          if (!grouped.has(key)) {
            grouped.set(key, { strike, expiration: exp, callOI: 0, putOI: 0, callGamma: 0, putGamma: 0, callVolume: 0, putVolume: 0 });
          }
          const entry = grouped.get(key)!;
          const gamma = snap?.greeks?.gamma ?? 0;
          const oi = snap?.openInterest ?? 0;
          const vol = snap?.latestTrade?.s ?? 0;

          if (optType === 'C') { entry.callOI += oi; entry.callGamma = gamma; entry.callVolume += vol; }
          else { entry.putOI += oi; entry.putGamma = gamma; entry.putVolume += vol; }
        }
        grouped.forEach(item => realChain.push(item));
        if (realChain.length > 0) { chain = realChain; dataSource = 'alpaca'; }
      }
    }
  } catch { /* fall through to synthetic */ }

  if (!chain) {
    chain = generateSyntheticChain(spotPrice, symbol);
    dataSource = 'synthetic';
  }

  // 3. Calculate GEX
  const result = calculateGEX(chain, spotPrice);
  const impact = gexImpact(result.levels.netGEX, spotPrice);

  return {
    symbol,
    spotPrice,
    netGEX: Math.round(result.levels.netGEX * 100) / 100,
    regime: result.levels.regime,
    impact,
    levels: {
      putWall: result.levels.putWall,
      callWall: result.levels.callWall,
      hvl: result.levels.hvl,
      gammaFlip: result.levels.gammaFlip,
      pinStrikes: result.levels.pinStrikes,
    },
    dataSource,
  };
}

// ─── Core Types & Functions ─────────────────────────────────────────────────

export interface OptionsChainItem {
  strike: number;
  expiration: string;
  callOI: number;
  putOI: number;
  callGamma: number;
  putGamma: number;
  callVolume: number;
  putVolume: number;
}

export interface GEXLevels {
  putWall: number;
  callWall: number;
  hvl: number;
  gammaFlip: number;
  netGEX: number;
  regime: 'positive' | 'negative';
  pinStrikes: number[];
}

export interface GEXResult {
  byStrike: Map<number, number>;
  levels: GEXLevels;
  totalGEX: number;
}

export function calculateGEX(chain: OptionsChainItem[], spotPrice: number): GEXResult {
  const byStrike = new Map<number, number>();

  for (const item of chain) {
    const callGEX = item.callOI * 100 * item.callGamma * spotPrice * spotPrice * 0.01;
    const putGEX = item.putOI * 100 * item.putGamma * spotPrice * spotPrice * 0.01;
    const netStrikeGEX = callGEX - putGEX;
    byStrike.set(item.strike, (byStrike.get(item.strike) ?? 0) + netStrikeGEX);
  }

  const levels = findGEXLevels(byStrike, chain);
  let totalGEX = 0;
  byStrike.forEach(val => { totalGEX += val; });

  return { byStrike, levels, totalGEX };
}

export function findGEXLevels(gexByStrike: Map<number, number>, chain: OptionsChainItem[]): GEXLevels {
  let putWall = 0;
  let putWallValue = 0;
  let callWall = 0;
  let callWallValue = 0;

  gexByStrike.forEach((gex, strike) => {
    if (gex < 0 && (putWallValue === 0 || gex < putWallValue)) {
      putWall = strike;
      putWallValue = gex;
    }
    if (gex > 0 && gex > callWallValue) {
      callWall = strike;
      callWallValue = gex;
    }
  });

  const oiByStrike = new Map<number, number>();
  for (const item of chain) {
    const totalOI = item.callOI + item.putOI;
    oiByStrike.set(item.strike, (oiByStrike.get(item.strike) ?? 0) + totalOI);
  }

  let hvl = 0;
  let maxOI = 0;
  oiByStrike.forEach((oi, strike) => {
    if (oi > maxOI) {
      maxOI = oi;
      hvl = strike;
    }
  });

  const sortedStrikes = Array.from(gexByStrike.keys()).sort((a, b) => a - b);
  let gammaFlip = 0;
  for (let i = 1; i < sortedStrikes.length; i++) {
    const prev = gexByStrike.get(sortedStrikes[i - 1])!;
    const curr = gexByStrike.get(sortedStrikes[i])!;
    if ((prev > 0 && curr <= 0) || (prev <= 0 && curr > 0)) {
      gammaFlip = Math.abs(prev) < Math.abs(curr) ? sortedStrikes[i - 1] : sortedStrikes[i];
      break;
    }
  }

  let netGEX = 0;
  gexByStrike.forEach(val => { netGEX += val; });

  const regime: 'positive' | 'negative' = netGEX > 0 ? 'positive' : 'negative';

  const pinStrikes = Array.from(gexByStrike.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([strike]) => strike);

  return { putWall, callWall, hvl, gammaFlip, netGEX, regime, pinStrikes };
}

export function gexImpact(netGEX: number, spotPrice: number): string {
  const regime = netGEX > 0 ? 'positive' : 'negative';
  const normalized = Math.abs(netGEX) / (spotPrice * spotPrice);

  if (regime === 'positive') {
    if (normalized > 1) {
      return 'Strong positive gamma: dealers hedge by selling rallies and buying dips. Expect suppressed volatility and mean-reversion toward pin strikes.';
    }
    return 'Moderate positive gamma: dealer hedging dampens moves. Low-vol, range-bound conditions likely.';
  }

  if (normalized > 1) {
    return 'Strong negative gamma: dealers amplify moves by buying rallies and selling dips. Expect elevated volatility and potential for outsized directional moves.';
  }
  return 'Moderate negative gamma: dealer hedging adds fuel to directional moves. Elevated vol and trending conditions likely.';
}
