import { NextResponse } from 'next/server';
import { parseOCCSymbol, daysToExpiration } from '@/lib/options/symbols';
import { calculateGreeks } from '@/lib/options/greeks';

const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const ALPACA_DATA_URL = 'https://data.alpaca.markets';

const alpacaHeaders = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
};

export async function GET() {
  try {
    // Fetch all positions from Alpaca
    const res = await fetch(`${ALPACA_BASE_URL}/v2/positions`, {
      headers: alpacaHeaders,
    });

    if (!res.ok) {
      return NextResponse.json({ positions: [], error: 'Failed to fetch positions' });
    }

    const positions = await res.json();

    // Filter for options positions (OCC symbols are longer and contain C/P)
    const optionPositions = [];

    for (const pos of positions) {
      const parsed = parseOCCSymbol(pos.symbol);
      if (!parsed) continue; // Not an option

      const qty = Math.abs(parseFloat(pos.qty));
      const avgCost = Math.abs(parseFloat(pos.avg_entry_price));
      const currentPrice = parseFloat(pos.current_price) || 0;
      const pnl = parseFloat(pos.unrealized_pl) || 0;
      const pnlPercent = parseFloat(pos.unrealized_plpc) * 100 || 0;
      const direction = parseFloat(pos.qty) > 0 ? 'long' : 'short';
      const dte = daysToExpiration(parsed.expiry);

      // Get underlying stock price for Greeks
      let stockPrice = 0;
      try {
        const quoteRes = await fetch(
          `${ALPACA_DATA_URL}/v2/stocks/${parsed.underlying}/quotes/latest`,
          { headers: alpacaHeaders }
        );
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          stockPrice = ((quoteData.quote?.ap || 0) + (quoteData.quote?.bp || 0)) / 2;
        }
      } catch {
        // Continue without stock price
      }

      // Calculate Greeks
      let greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
      if (stockPrice > 0) {
        const T = Math.max(dte / 365.25, 0.001);
        const calc = calculateGreeks(stockPrice, parsed.strike, T, 0.05, 0.3, parsed.type);
        const sign = direction === 'long' ? 1 : -1;
        greeks = {
          delta: calc.delta * qty * sign,
          gamma: calc.gamma * qty,
          theta: calc.theta * qty * 100 * sign,
          vega: calc.vega * qty * sign,
        };
      }

      optionPositions.push({
        id: pos.asset_id || pos.symbol,
        underlying: parsed.underlying,
        optionSymbol: pos.symbol,
        contractType: parsed.type,
        strike: parsed.strike,
        expiration: parsed.expiry,
        direction,
        quantity: qty,
        avgCost,
        currentPrice,
        pnl,
        pnlPercent,
        dte,
        ...greeks,
      });
    }

    // Calculate portfolio-level Greeks
    const portfolioGreeks = {
      netDelta: optionPositions.reduce((sum, p) => sum + p.delta, 0),
      netGamma: optionPositions.reduce((sum, p) => sum + p.gamma, 0),
      netTheta: optionPositions.reduce((sum, p) => sum + p.theta, 0),
      netVega: optionPositions.reduce((sum, p) => sum + p.vega, 0),
      sharesEquivalent: Math.round(optionPositions.reduce((sum, p) => sum + p.delta, 0) * 100),
      monthlyTheta: optionPositions.reduce((sum, p) => sum + p.theta, 0) * 30,
    };

    return NextResponse.json({
      positions: optionPositions,
      greeks: portfolioGreeks,
      count: optionPositions.length,
    });
  } catch (err) {
    console.error('Options positions error:', err);
    return NextResponse.json({ positions: [], greeks: null, error: 'Failed' });
  }
}
