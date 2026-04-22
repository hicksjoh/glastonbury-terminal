import { NextRequest, NextResponse } from 'next/server';
import { bsPrice } from '@/lib/black-scholes';
import {
  buildVolSurface,
  analyzeSkew,
  termStructure,
  findMispricing,
} from '@/lib/volatility-surface';
import { getQuote } from '@/lib/fmp-client';

const FMP_KEY = process.env.FMP_API_KEY;

/**
 * Generate expiration date strings for N days from now.
 */
function expirationDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().split('T')[0];
}

/**
 * Generate synthetic options dataset using Black-Scholes pricing.
 * Creates calls and puts across multiple expirations and strikes.
 */
function generateSyntheticOptions(
  spotPrice: number,
  riskFreeRate: number = 0.05,
  baseVol: number = 0.25
): Array<{
  strike: number;
  expiry: string;
  price: number;
  type: 'call' | 'put';
  spotPrice: number;
}> {
  const expirations = [7, 14, 30, 60, 90];
  const options: Array<{
    strike: number;
    expiry: string;
    price: number;
    type: 'call' | 'put';
    spotPrice: number;
  }> = [];

  // Strikes from -15% to +15% of spot in $5 increments
  const minStrike = Math.floor((spotPrice * 0.85) / 5) * 5;
  const maxStrike = Math.ceil((spotPrice * 1.15) / 5) * 5;

  for (const daysOut of expirations) {
    const expiry = expirationDate(daysOut);
    const T = daysOut / 365;

    for (let strike = minStrike; strike <= maxStrike; strike += 5) {
      const moneyness = strike / spotPrice;

      // Realistic vol smile: higher IV for OTM puts, slight smile for OTM calls
      const skewFactor = -0.12 * (moneyness - 1); // negative skew
      const smileFactor = 0.08 * Math.pow(moneyness - 1, 2); // convexity / smile
      // Term structure: shorter-dated options have slightly higher vol
      const termFactor = 1 + 0.05 * (1 - T / 0.25);

      const sigma = Math.max(0.05, baseVol * termFactor + skewFactor + smileFactor);

      for (const type of ['call', 'put'] as const) {
        const price = bsPrice(spotPrice, strike, T, riskFreeRate, sigma, type);

        // Only include options with meaningful price
        if (price > 0.05) {
          options.push({
            strike,
            expiry,
            price,
            type,
            spotPrice,
          });
        }
      }
    }
  }

  return options;
}

/**
 * Generate a "historical" baseline surface with slightly different vol levels
 * to enable mispricing detection.
 */
function generateHistoricalOptions(
  spotPrice: number,
  riskFreeRate: number = 0.05,
  baseVol: number = 0.23
): Array<{
  strike: number;
  expiry: string;
  price: number;
  type: 'call' | 'put';
  spotPrice: number;
}> {
  return generateSyntheticOptions(spotPrice, riskFreeRate, baseVol);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'AAPL').toUpperCase();

    if (!FMP_KEY) {
      return NextResponse.json(
        { error: 'FMP_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // Fetch current stock price via /stable client
    const q = await getQuote(symbol);

    if (!q) {
      return NextResponse.json(
        { error: `Failed to fetch quote for ${symbol}` },
        { status: 502 }
      );
    }

    // Normalize to the legacy [{...}] shape used below.
    const quoteData = [q];

    if (!quoteData || quoteData.length === 0) {
      return NextResponse.json(
        { error: `No quote data found for ${symbol}` },
        { status: 404 }
      );
    }

    const spotPrice = quoteData[0].price;

    if (!spotPrice || spotPrice <= 0) {
      return NextResponse.json(
        { error: `Invalid price data for ${symbol}` },
        { status: 502 }
      );
    }

    const riskFreeRate = 0.05;

    // Generate synthetic options datasets
    const currentOptions = generateSyntheticOptions(spotPrice, riskFreeRate, 0.25);
    const historicalOptions = generateHistoricalOptions(spotPrice, riskFreeRate, 0.23);

    // Build volatility surfaces
    const surface = buildVolSurface(currentOptions, spotPrice, riskFreeRate);
    const historicalSurface = buildVolSurface(historicalOptions, spotPrice, riskFreeRate);

    // Analyze skew for each expiration
    const skewAnalysis = surface.expirations.map((exp) =>
      ({ expiration: exp, ...analyzeSkew(surface, exp, spotPrice) })
    );

    // Term structure
    const termStructureData = termStructure(surface, spotPrice);

    // Find mispricings between current and historical surfaces
    const mispricings = findMispricing(surface, historicalSurface, 0.02);

    return NextResponse.json({
      symbol,
      spotPrice,
      surface: {
        grid: surface.grid,
        strikes: surface.strikes,
        expirations: surface.expirations,
      },
      skewAnalysis,
      termStructure: termStructureData,
      mispricings,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Vol surface API error:', error);
    return NextResponse.json(
      { error: 'Internal server error building volatility surface' },
      { status: 500 }
    );
  }
}
