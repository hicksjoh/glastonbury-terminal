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
