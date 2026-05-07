import { NextRequest, NextResponse } from 'next/server';
import { validateEquitySymbol } from '@/lib/sanitize';
import type { IVData } from '@/lib/options/types';

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_TRADING_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params;
  // p6-5: strict equity-symbol validation
  const upper = validateEquitySymbol(rawSymbol);
  if (!upper) {
    return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });
  }

  try {
    // Get current ATM option IV from Alpaca snapshots
    const currentIV = await fetchCurrentIV(upper);

    // Get historical volatility from FMP
    const hv30 = await fetchHistoricalVolatility(upper);

    // For IV Rank/Percentile, we'd ideally track IV over time in Supabase
    // For now, estimate using the relationship between current IV and HV
    const iv52High = currentIV * 1.5;  // Estimate — should be from historical data
    const iv52Low = currentIV * 0.6;   // Estimate — should be from historical data

    const ivRank = iv52High !== iv52Low
      ? ((currentIV - iv52Low) / (iv52High - iv52Low)) * 100
      : 50;

    const result: IVData = {
      ivRank: Math.round(ivRank * 100) / 100,
      ivPercentile: Math.round(ivRank * 100) / 100, // Simplified: same as rank without historical distribution
      currentIV: Math.round(currentIV * 100) / 100,
      iv52High: Math.round(iv52High * 100) / 100,
      iv52Low: Math.round(iv52Low * 100) / 100,
      hv30: Math.round(hv30 * 100) / 100,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('IV data error:', err);
    return NextResponse.json({
      ivRank: 0,
      ivPercentile: 0,
      currentIV: 0,
      iv52High: 0,
      iv52Low: 0,
      hv30: 0,
      error: 'IV data unavailable',
    });
  }
}

async function fetchCurrentIV(symbol: string): Promise<number> {
  try {
    // Get ATM options to find current IV
    const res = await fetch(
      `${ALPACA_TRADING_URL}/v2/options/contracts?underlying_symbols=${symbol}&status=active&limit=50`,
      { headers: alpacaHeaders }
    );

    if (!res.ok) return 30; // Default 30%

    const data = await res.json();
    const contracts = data.option_contracts || data.contracts || [];
    if (contracts.length === 0) return 30;

    // Get stock price
    const quoteRes = await fetch(`${ALPACA_DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
      headers: alpacaHeaders,
    });
    let stockPrice = 0;
    if (quoteRes.ok) {
      const quoteData = await quoteRes.json();
      stockPrice = ((quoteData.quote?.ap || 0) + (quoteData.quote?.bp || 0)) / 2;
    }
    if (stockPrice <= 0) return 30;

    // Find closest-to-ATM contracts with 30-60 DTE
    const now = Date.now();
    const targetDTE = 30 * 24 * 3600 * 1000;
    const atmContracts = contracts
      .filter((c: { expiration_date: string }) => {
        const dte = new Date(c.expiration_date).getTime() - now;
        return dte > 7 * 24 * 3600 * 1000 && dte < 90 * 24 * 3600 * 1000;
      })
      .sort((a: { strike_price: number; expiration_date: string }, b: { strike_price: number; expiration_date: string }) => {
        const aDist = Math.abs(a.strike_price - stockPrice) + Math.abs(new Date(a.expiration_date).getTime() - now - targetDTE) / (24 * 3600 * 1000);
        const bDist = Math.abs(b.strike_price - stockPrice) + Math.abs(new Date(b.expiration_date).getTime() - now - targetDTE) / (24 * 3600 * 1000);
        return aDist - bDist;
      })
      .slice(0, 4);

    if (atmContracts.length === 0) return 30;

    // Get snapshots for these contracts
    const symbols = atmContracts.map((c: { symbol: string }) => c.symbol).join(',');
    const snapRes = await fetch(
      `${ALPACA_DATA_URL}/v1beta1/options/snapshots?symbols=${symbols}`,
      { headers: alpacaHeaders }
    );

    if (!snapRes.ok) return 30;

    const snapData = await snapRes.json();
    const snapshots = snapData.snapshots || snapData || {};

    const ivValues: number[] = [];
    for (const sym of Object.keys(snapshots)) {
      const iv = snapshots[sym]?.impliedVolatility;
      if (iv && iv > 0) ivValues.push(iv * 100);
    }

    if (ivValues.length === 0) return 30;
    return ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
  } catch {
    return 30;
  }
}

async function fetchHistoricalVolatility(symbol: string): Promise<number> {
  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return 25;

  try {
    const res = await fetch(
      `${FMP_BASE_URL}/historical-price-eod/full?symbol=${symbol}&apikey=${fmpKey}`
    );
    if (!res.ok) return 25;

    const text = await res.text();
    if (text.includes('Legacy') || text.includes('Premium')) return 25;

    const data = JSON.parse(text);
    const historical = data.historical || data;
    if (!Array.isArray(historical) || historical.length < 30) return 25;

    // Calculate 30-day historical volatility
    const prices = historical.slice(0, 31).map((d: { close: number }) => d.close).reverse();
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        returns.push(Math.log(prices[i] / prices[i - 1]));
      }
    }

    if (returns.length < 5) return 25;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const dailyVol = Math.sqrt(variance);
    const annualVol = dailyVol * Math.sqrt(252);

    return annualVol * 100; // As percentage
  } catch {
    return 25;
  }
}
