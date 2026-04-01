import { NextRequest, NextResponse } from 'next/server';
import { bsPrice, bsDelta, bsTheta, bsGamma, normalCDF } from '@/lib/black-scholes';

const RISK_FREE_RATE = 0.05;

interface SimLeg {
  symbol: string;
  strike: number;
  expiration: string;
  type: 'call' | 'put';
  side: 'long' | 'short';
  quantity: number;
  premium?: number;
  iv?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      legs,
      priceRange,
      dteRange,
      ivChange = 0,
    } = body as {
      legs: SimLeg[];
      priceRange: { min: number; max: number; step: number };
      dteRange: { current: number; simDays: number };
      ivChange: number;
    };

    if (!legs || legs.length === 0) {
      return NextResponse.json({ error: 'At least one leg required' }, { status: 400 });
    }

    const step = priceRange.step || 1;
    const currentDte = dteRange.current || 30;
    const simDays = dteRange.simDays || currentDte;

    // Default IV if not provided
    const defaultIV = 0.30;

    // Calculate entry cost (total premium paid/received)
    let totalEntryCost = 0;
    for (const leg of legs) {
      const premium = leg.premium || bsPrice(
        (priceRange.min + priceRange.max) / 2,
        leg.strike,
        currentDte / 365,
        RISK_FREE_RATE,
        leg.iv || defaultIV,
        leg.type
      );
      const sign = leg.side === 'long' ? -1 : 1; // long = pay, short = receive
      totalEntryCost += sign * premium * leg.quantity * 100;
    }

    // Generate P&L grid
    const grid: { price: number; dte: number; pnl: number; delta: number; theta: number; gamma: number }[] = [];

    // DTE steps: simulate from current DTE to 0
    const dteSteps = [currentDte, Math.round(currentDte * 0.75), Math.round(currentDte * 0.5), Math.round(currentDte * 0.25), 0];

    for (let price = priceRange.min; price <= priceRange.max; price += step) {
      for (const dte of dteSteps) {
        if (dte > simDays && dte !== currentDte) continue;

        let totalPnl = 0;
        let totalDelta = 0;
        let totalTheta = 0;
        let totalGamma = 0;
        const T = Math.max(dte / 365, 0);

        for (const leg of legs) {
          const iv = (leg.iv || defaultIV) + ivChange;
          const adjustedIV = Math.max(0.01, iv);

          const currentVal = dte === 0
            ? (leg.type === 'call' ? Math.max(price - leg.strike, 0) : Math.max(leg.strike - price, 0))
            : bsPrice(price, leg.strike, T, RISK_FREE_RATE, adjustedIV, leg.type);

          const entryVal = leg.premium || bsPrice(
            (priceRange.min + priceRange.max) / 2,
            leg.strike,
            currentDte / 365,
            RISK_FREE_RATE,
            leg.iv || defaultIV,
            leg.type
          );

          const sign = leg.side === 'long' ? 1 : -1;
          totalPnl += (currentVal - entryVal) * sign * leg.quantity * 100;

          if (T > 0) {
            totalDelta += bsDelta(price, leg.strike, T, RISK_FREE_RATE, adjustedIV, leg.type) * sign * leg.quantity;
            totalTheta += bsTheta(price, leg.strike, T, RISK_FREE_RATE, adjustedIV, leg.type) * sign * leg.quantity * 100;
            totalGamma += bsGamma(price, leg.strike, T, RISK_FREE_RATE, adjustedIV) * sign * leg.quantity;
          }
        }

        grid.push({
          price: Math.round(price * 100) / 100,
          dte,
          pnl: Math.round(totalPnl * 100) / 100,
          delta: Math.round(totalDelta * 1000) / 1000,
          theta: Math.round(totalTheta * 100) / 100,
          gamma: Math.round(totalGamma * 10000) / 10000,
        });
      }
    }

    // Calculate summary stats from expiration P&L
    const expirationPoints = grid.filter(g => g.dte === 0);
    const pnls = expirationPoints.map(p => p.pnl);
    const maxProfit = Math.max(...pnls);
    const maxLoss = Math.min(...pnls);

    // Find breakevens (where P&L crosses zero)
    const breakevens: number[] = [];
    for (let i = 1; i < expirationPoints.length; i++) {
      const prev = expirationPoints[i - 1];
      const curr = expirationPoints[i];
      if ((prev.pnl <= 0 && curr.pnl > 0) || (prev.pnl >= 0 && curr.pnl < 0)) {
        // Linear interpolation
        const ratio = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(curr.pnl));
        breakevens.push(Math.round((prev.price + ratio * (curr.price - prev.price)) * 100) / 100);
      }
    }

    // Probability of profit (simplified using normal distribution)
    const midPrice = (priceRange.min + priceRange.max) / 2;
    const annualizedVol = defaultIV;
    const dailyVol = annualizedVol / Math.sqrt(252);
    const totalVol = dailyVol * Math.sqrt(currentDte);

    let probOfProfit = 0.5;
    if (breakevens.length > 0 && totalVol > 0) {
      // Probability that price stays between breakevens (or above/below)
      const profitablePoints = expirationPoints.filter(p => p.pnl > 0).length;
      probOfProfit = profitablePoints / Math.max(expirationPoints.length, 1);

      // Weight by normal distribution
      if (breakevens.length === 1) {
        const z = (breakevens[0] - midPrice) / (midPrice * totalVol);
        probOfProfit = pnls[pnls.length - 1] > 0 ? normalCDF(z) : 1 - normalCDF(z);
      }
    }

    return NextResponse.json({
      grid,
      maxProfit: Math.round(maxProfit * 100) / 100,
      maxLoss: Math.round(maxLoss * 100) / 100,
      breakevens,
      probabilityOfProfit: Math.round(probOfProfit * 10000) / 100,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
