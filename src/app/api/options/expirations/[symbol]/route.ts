import { NextRequest, NextResponse } from 'next/server';
import { validateEquitySymbol } from '@/lib/sanitize';

const ALPACA_TRADING_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

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
    // Fetch active option contracts from Alpaca
    const contractsRes = await fetch(
      `${ALPACA_TRADING_URL}/v2/options/contracts?underlying_symbols=${upper}&status=active&limit=1000`,
      { headers: alpacaHeaders }
    );

    if (contractsRes.ok) {
      const data = await contractsRes.json();
      const contracts = data.option_contracts || data.contracts || [];

      // Extract unique expiration dates
      const expirations = new Set<string>();
      for (const c of contracts) {
        if (c.expiration_date) {
          expirations.add(c.expiration_date);
        }
      }

      const sorted = Array.from(expirations).sort();

      // Categorize: weekly vs monthly vs quarterly vs LEAPS
      const now = new Date();
      const categorized = sorted.map(exp => {
        const date = new Date(exp);
        const dte = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const isThirdFriday = isMonthlyExpiration(date);
        const isQuarterly = isThirdFriday && [2, 5, 8, 11].includes(date.getMonth());
        const isLeaps = dte > 365;

        let category: 'weekly' | 'monthly' | 'quarterly' | 'leaps' = 'weekly';
        if (isLeaps) category = 'leaps';
        else if (isQuarterly) category = 'quarterly';
        else if (isThirdFriday) category = 'monthly';

        return { date: exp, dte, category };
      });

      return NextResponse.json({
        symbol: upper,
        expirations: categorized,
        count: categorized.length,
      });
    }

    // Fallback: generate standard expirations
    const fallback = generateStandardExpirations();
    return NextResponse.json({
      symbol: upper,
      expirations: fallback,
      count: fallback.length,
      note: 'Generated standard expirations — live data unavailable',
    });
  } catch (err) {
    console.error('Expirations fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch expirations' }, { status: 500 });
  }
}

function isMonthlyExpiration(date: Date): boolean {
  // Third Friday of the month
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfWeek = first.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const thirdFriday = 1 + daysUntilFriday + 14;
  return date.getDate() === thirdFriday;
}

function generateStandardExpirations(): { date: string; dte: number; category: string }[] {
  const results: { date: string; dte: number; category: string }[] = [];
  const now = new Date();

  // Weekly: next 8 Fridays
  const d = new Date(now);
  const day = d.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFriday);
  for (let i = 0; i < 8; i++) {
    const dte = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    results.push({ date: d.toISOString().split('T')[0], dte, category: 'weekly' });
    d.setDate(d.getDate() + 7);
  }

  // Monthly: next 6 months (3rd Friday)
  for (let m = 0; m < 6; m++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + m + 2, 1);
    const first = monthDate;
    const dayOfWeek = first.getDay();
    const daysUntilFri = (5 - dayOfWeek + 7) % 7;
    const thirdFri = new Date(first.getFullYear(), first.getMonth(), 1 + daysUntilFri + 14);
    if (thirdFri > now) {
      const dte = Math.ceil((thirdFri.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      results.push({ date: thirdFri.toISOString().split('T')[0], dte, category: 'monthly' });
    }
  }

  return results;
}
