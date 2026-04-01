import { NextRequest, NextResponse } from 'next/server';
import { calculateGEX, gexImpact, OptionsChainItem } from '@/lib/gex-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** Black-Scholes-style gamma approximation for ATM options */
function syntheticGamma(spot: number, strike: number, dte: number): number {
  const t = Math.max(dte / 365, 0.001);
  const sigma = 0.2; // assumed IV
  const d1Num = Math.log(spot / strike) + 0.5 * sigma * sigma * t;
  const d1 = d1Num / (sigma * Math.sqrt(t));
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (spot * sigma * Math.sqrt(t));
}

/** Generate realistic synthetic options chain around the current price */
function generateSyntheticChain(spot: number, symbol: string): OptionsChainItem[] {
  const chain: OptionsChainItem[] = [];
  const today = new Date();

  // Generate 3 expiration dates: this Friday, next Friday, monthly
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

  // Strike spacing based on price level
  const spacing = spot > 400 ? 5 : spot > 100 ? 2 : spot > 50 ? 1 : 0.5;
  const range = spot * 0.1; // +/- 10%
  const lowStrike = Math.floor((spot - range) / spacing) * spacing;
  const highStrike = Math.ceil((spot + range) / spacing) * spacing;

  // Seed the RNG deterministically from symbol so results are stable within a session
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i) * (i + 1);
  const seededRandom = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 0x7fffffff;
  };

  for (const exp of expirations) {
    const dte = Math.max(
      1,
      Math.round((new Date(exp).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    );

    for (let strike = lowStrike; strike <= highStrike; strike += spacing) {
      const gamma = syntheticGamma(spot, strike, dte);
      const moneyness = Math.abs(spot - strike) / spot;

      // OI peaks near ATM and decays outward; round strikes attract more OI
      const atmFactor = Math.exp(-moneyness * moneyness * 200);
      const roundBonus = strike % (spacing * 10) === 0 ? 1.8 : 1;
      const baseOI = 2000 + seededRandom() * 8000;

      const callOI = Math.round(baseOI * atmFactor * roundBonus * (1 + seededRandom() * 0.5));
      const putOI = Math.round(baseOI * atmFactor * roundBonus * (1 + seededRandom() * 0.5));
      const callVolume = Math.round(callOI * (0.05 + seededRandom() * 0.15));
      const putVolume = Math.round(putOI * (0.05 + seededRandom() * 0.15));

      chain.push({
        strike: roundTo(strike, 2),
        expiration: exp,
        callOI,
        putOI,
        callGamma: roundTo(gamma * (1 + (seededRandom() - 0.5) * 0.1), 8),
        putGamma: roundTo(gamma * (1 + (seededRandom() - 0.5) * 0.1), 8),
        callVolume,
        putVolume,
      });
    }
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Fetch current price from FMP
// ---------------------------------------------------------------------------

async function fetchSpotPrice(symbol: string, fmpKey: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${fmpKey}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && typeof data[0].price === 'number') {
      return data[0].price;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Attempt to fetch real options chain from Alpaca
// ---------------------------------------------------------------------------

async function fetchAlpacaChain(
  symbol: string,
  alpacaKeyId: string,
  alpacaSecret: string
): Promise<OptionsChainItem[] | null> {
  try {
    const url = `https://data.alpaca.markets/v1beta1/options/snapshots/${encodeURIComponent(symbol)}?feed=indicative`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaKeyId,
        'APCA-API-SECRET-KEY': alpacaSecret,
      },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.snapshots || typeof data.snapshots !== 'object') return null;

    const chain: OptionsChainItem[] = [];
    const grouped = new Map<
      string,
      { callOI: number; putOI: number; callGamma: number; putGamma: number; callVolume: number; putVolume: number; strike: number; expiration: string }
    >();

    for (const [contractSymbol, snap] of Object.entries(data.snapshots) as [string, any][]) {
      const greeks = snap?.greeks;
      const trade = snap?.latestTrade;
      const quote = snap?.latestQuote;

      // Parse the OCC symbol for strike, expiration, and type
      // Format: UNDERLYING  YYMMDD C/P STRIKE (padded)
      const match = contractSymbol.match(/([A-Z]+)\s*(\d{6})([CP])(\d{8})/);
      if (!match) continue;

      const expiration = `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`;
      const optionType = match[3]; // C or P
      const strike = parseInt(match[4], 10) / 1000;
      const key = `${strike}-${expiration}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          strike,
          expiration,
          callOI: 0,
          putOI: 0,
          callGamma: 0,
          putGamma: 0,
          callVolume: 0,
          putVolume: 0,
        });
      }
      const entry = grouped.get(key)!;
      const gamma = greeks?.gamma ?? 0;
      const oi = snap?.openInterest ?? 0;
      const volume = trade?.s ?? 0;

      if (optionType === 'C') {
        entry.callOI += oi;
        entry.callGamma = gamma;
        entry.callVolume += volume;
      } else {
        entry.putOI += oi;
        entry.putGamma = gamma;
        entry.putVolume += volume;
      }
    }

    grouped.forEach(item => {
      chain.push(item);
    });

    return chain.length > 0 ? chain : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') ?? 'SPY').toUpperCase();

    const alpacaKeyId = process.env.APCA_API_KEY_ID ?? '';
    const alpacaSecret = process.env.APCA_API_SECRET_KEY ?? '';
    const fmpKey = process.env.FMP_API_KEY ?? '';

    // ---- Spot price ----
    let spotPrice: number | null = null;
    if (fmpKey) {
      spotPrice = await fetchSpotPrice(symbol, fmpKey);
    }
    // Fallback defaults when no API key or market is closed
    if (!spotPrice) {
      const defaults: Record<string, number> = {
        SPY: 570,
        QQQ: 480,
        IWM: 210,
        AAPL: 230,
        TSLA: 270,
        NVDA: 120,
        AMZN: 200,
        MSFT: 420,
        META: 590,
        GOOGL: 165,
      };
      spotPrice = defaults[symbol] ?? 100;
    }

    // ---- Options chain ----
    let chain: OptionsChainItem[] | null = null;
    let dataSource = 'synthetic';

    // Try Alpaca first
    if (alpacaKeyId && alpacaSecret) {
      chain = await fetchAlpacaChain(symbol, alpacaKeyId, alpacaSecret);
      if (chain) dataSource = 'alpaca';
    }

    // Fall back to synthetic data
    if (!chain) {
      chain = generateSyntheticChain(spotPrice, symbol);
      dataSource = 'synthetic';
    }

    // ---- Calculate GEX ----
    const result = calculateGEX(chain, spotPrice);
    const impact = gexImpact(result.levels.netGEX, spotPrice);

    // Convert byStrike Map to array for JSON serialization
    const byStrike = Array.from(result.byStrike.entries())
      .map(([strike, gex]) => ({ strike, gex: roundTo(gex, 2) }))
      .sort((a, b) => a.strike - b.strike);

    // Expiration breakdown
    const expMap = new Map<string, number>();
    for (const item of chain) {
      const callGEX = item.callOI * 100 * item.callGamma * spotPrice * spotPrice * 0.01;
      const putGEX = item.putOI * 100 * item.putGamma * spotPrice * spotPrice * 0.01;
      const net = callGEX - putGEX;
      expMap.set(item.expiration, (expMap.get(item.expiration) ?? 0) + net);
    }
    const expirationBreakdown = Array.from(expMap.entries())
      .map(([expiration, gex]) => ({ expiration, gex: roundTo(gex, 2) }))
      .sort((a, b) => a.expiration.localeCompare(b.expiration));

    return NextResponse.json({
      symbol,
      spotPrice,
      netGEX: roundTo(result.levels.netGEX, 2),
      regime: result.levels.regime,
      levels: {
        putWall: result.levels.putWall,
        callWall: result.levels.callWall,
        hvl: result.levels.hvl,
        gammaFlip: result.levels.gammaFlip,
        pinStrikes: result.levels.pinStrikes,
      },
      impact,
      byStrike,
      expirationBreakdown,
      dataSource,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[/api/gex] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
