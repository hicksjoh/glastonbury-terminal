import { NextResponse } from 'next/server';
import { getAccount, getPositions } from '@/lib/alpaca';

export const revalidate = 30;

export async function GET() {
  try {
    const [account, positions] = await Promise.all([
      getAccount().catch(() => null),
      getPositions().catch(() => []),
    ]);

    const positionData = Array.isArray(positions) ? positions.map((p: Record<string, string>) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      market_value: parseFloat(p.market_value),
      cost_basis: parseFloat(p.cost_basis),
      unrealized_pl: parseFloat(p.unrealized_pl),
      unrealized_plpc: parseFloat(p.unrealized_plpc),
      current_price: parseFloat(p.current_price),
      change_today: parseFloat(p.change_today),
      asset_class: p.asset_class,
    })) : [];

    const totalMarketValue = positionData.reduce((sum: number, p: { market_value: number }) => sum + p.market_value, 0);
    const totalUnrealizedPl = positionData.reduce((sum: number, p: { unrealized_pl: number }) => sum + p.unrealized_pl, 0);

    return NextResponse.json({
      success: true,
      data: {
        equity: account ? parseFloat(account.equity) : 0,
        buying_power: account ? parseFloat(account.buying_power) : 0,
        cash: account ? parseFloat(account.cash) : 0,
        portfolio_value: account ? parseFloat(account.portfolio_value) : 0,
        total_market_value: totalMarketValue,
        total_unrealized_pl: totalUnrealizedPl,
        day_change: account ? parseFloat(account.equity) - parseFloat(account.last_equity) : 0,
        day_change_pct: account ? ((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity) * 100) : 0,
        positions: positionData,
        status: account?.status || 'unknown',
        pattern_day_trader: account?.pattern_day_trader || false,
      },
    });
  } catch (error) {
    console.error('Portfolio API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch portfolio data' }, { status: 500 });
  }
}
