import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data: trades, error } = await supabase
      .from('trade_journal')
      .select('*')
      .order('entry_date', { ascending: false });

    if (error) throw error;
    if (!trades || trades.length === 0) {
      return NextResponse.json({
        overview: { totalTrades: 0, winRate: 0, expectancy: 0, sharpeRatio: 0, profitFactor: 0 },
        byStrategy: [],
        byTimeOfDay: [],
        byDayOfWeek: [],
        holdTime: { avgWinner: 0, avgLoser: 0 },
        streaks: { maxWin: 0, maxLoss: 0, current: 0 },
        monthlyPnl: [],
        keishaAccuracy: { agreed: 0, disagreed: 0, agreedAndRight: 0, disagreedAndRight: 0 },
        bestTrade: null,
        worstTrade: null,
        recentPerformance: { last10Trades: [], last30DaysPnl: 0 },
      });
    }

    // Closed trades only (have exit data)
    const closed = trades.filter((t: Record<string, unknown>) => t.exit_price != null && t.pnl != null);
    const winners = closed.filter((t: Record<string, unknown>) => Number(t.pnl) > 0);
    const losers = closed.filter((t: Record<string, unknown>) => Number(t.pnl) <= 0);

    // Overview
    const totalTrades = closed.length;
    const winRate = totalTrades > 0 ? Math.round((winners.length / totalTrades) * 10000) / 100 : 0;

    const avgWin = winners.length > 0
      ? winners.reduce((sum: number, t: Record<string, unknown>) => sum + Number(t.pnl), 0) / winners.length
      : 0;
    const avgLoss = losers.length > 0
      ? Math.abs(losers.reduce((sum: number, t: Record<string, unknown>) => sum + Number(t.pnl), 0) / losers.length)
      : 0;

    const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

    // Sharpe ratio (simplified)
    const returns = closed.map((t: Record<string, unknown>) => Number(t.pnl_percent || 0));
    const meanReturn = returns.reduce((a: number, b: number) => a + b, 0) / (returns.length || 1);
    const variance = returns.reduce((sum: number, r: number) => sum + (r - meanReturn) ** 2, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? Math.round((meanReturn / stdDev) * Math.sqrt(252) * 1000) / 1000 : 0;

    const profitFactor = avgLoss > 0
      ? Math.round((winners.reduce((s: number, t: Record<string, unknown>) => s + Number(t.pnl), 0) / Math.abs(losers.reduce((s: number, t: Record<string, unknown>) => s + Number(t.pnl), 0) || 1)) * 100) / 100
      : 0;

    // By strategy
    const strategyMap: Record<string, { trades: number; wins: number; totalReturn: number; totalPnl: number }> = {};
    for (const t of closed) {
      const strategy = String(t.strategy || 'unknown');
      if (!strategyMap[strategy]) strategyMap[strategy] = { trades: 0, wins: 0, totalReturn: 0, totalPnl: 0 };
      strategyMap[strategy].trades++;
      if (Number(t.pnl) > 0) strategyMap[strategy].wins++;
      strategyMap[strategy].totalReturn += Number(t.pnl_percent || 0);
      strategyMap[strategy].totalPnl += Number(t.pnl || 0);
    }
    const byStrategy = Object.entries(strategyMap).map(([strategy, data]) => ({
      strategy,
      trades: data.trades,
      winRate: Math.round((data.wins / data.trades) * 10000) / 100,
      avgReturn: Math.round((data.totalReturn / data.trades) * 100) / 100,
      totalPnl: Math.round(data.totalPnl * 100) / 100,
    }));

    // By time of day (based on entry date hour if available)
    const byTimeOfDay = Array.from({ length: 7 }, (_, h) => {
      const hour = 9 + h; // 9am - 3pm
      const hourTrades = closed.filter((t: Record<string, unknown>) => {
        const d = new Date(String(t.entry_date || ''));
        return d.getHours() === hour;
      });
      return {
        hour,
        trades: hourTrades.length,
        winRate: hourTrades.length > 0
          ? Math.round((hourTrades.filter((t: Record<string, unknown>) => Number(t.pnl) > 0).length / hourTrades.length) * 10000) / 100
          : 0,
      };
    });

    // By day of week
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDayOfWeek = dayNames.map((day, idx) => {
      const dayTrades = closed.filter((t: Record<string, unknown>) => new Date(String(t.entry_date || '')).getDay() === idx);
      return {
        day,
        trades: dayTrades.length,
        winRate: dayTrades.length > 0
          ? Math.round((dayTrades.filter((t: Record<string, unknown>) => Number(t.pnl) > 0).length / dayTrades.length) * 10000) / 100
          : 0,
      };
    }).filter(d => d.trades > 0);

    // Hold time
    const holdTimes = closed.map((t: Record<string, unknown>) => {
      const entry = new Date(String(t.entry_date || ''));
      const exit = new Date(String(t.exit_date || t.entry_date || ''));
      return { days: Math.max(0, (exit.getTime() - entry.getTime()) / 86400000), isWin: Number(t.pnl) > 0 };
    });
    const winHolds = holdTimes.filter(h => h.isWin);
    const lossHolds = holdTimes.filter(h => !h.isWin);
    const avgWinnerHold = winHolds.length > 0 ? Math.round(winHolds.reduce((s, h) => s + h.days, 0) / winHolds.length * 10) / 10 : 0;
    const avgLoserHold = lossHolds.length > 0 ? Math.round(lossHolds.reduce((s, h) => s + h.days, 0) / lossHolds.length * 10) / 10 : 0;

    // Streaks
    let maxWin = 0, maxLoss = 0, curStreak = 0;
    for (const t of closed) {
      if (Number(t.pnl) > 0) {
        curStreak = curStreak > 0 ? curStreak + 1 : 1;
        maxWin = Math.max(maxWin, curStreak);
      } else {
        curStreak = curStreak < 0 ? curStreak - 1 : -1;
        maxLoss = Math.max(maxLoss, Math.abs(curStreak));
      }
    }

    // Monthly P&L
    const monthlyMap: Record<string, { pnl: number; trades: number }> = {};
    for (const t of closed) {
      const d = new Date(String(t.entry_date || ''));
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[month]) monthlyMap[month] = { pnl: 0, trades: 0 };
      monthlyMap[month].pnl += Number(t.pnl || 0);
      monthlyMap[month].trades++;
    }
    const monthlyPnl = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, pnl: Math.round(data.pnl * 100) / 100, trades: data.trades }));

    // Keisha accuracy
    const withKeisha = closed.filter((t: Record<string, unknown>) => t.keisha_agreed != null);
    const agreed = withKeisha.filter((t: Record<string, unknown>) => t.keisha_agreed === true);
    const disagreed = withKeisha.filter((t: Record<string, unknown>) => t.keisha_agreed === false);
    const agreedAndRight = agreed.filter((t: Record<string, unknown>) => Number(t.pnl) > 0);
    const disagreedAndRight = disagreed.filter((t: Record<string, unknown>) => Number(t.pnl) <= 0); // Keisha was right to disagree

    // Best/worst trade
    const sortedByPnl = [...closed].sort((a, b) => Number(b.pnl) - Number(a.pnl));
    const bestTrade = sortedByPnl[0] || null;
    const worstTrade = sortedByPnl[sortedByPnl.length - 1] || null;

    // Recent performance
    const last10 = closed.slice(0, 10);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30DaysPnl = closed
      .filter((t: Record<string, unknown>) => new Date(String(t.entry_date || '')) >= thirtyDaysAgo)
      .reduce((sum: number, t: Record<string, unknown>) => sum + Number(t.pnl || 0), 0);

    return NextResponse.json({
      overview: {
        totalTrades,
        winRate,
        expectancy: Math.round(expectancy * 100) / 100,
        sharpeRatio,
        profitFactor,
      },
      byStrategy,
      byTimeOfDay,
      byDayOfWeek,
      holdTime: { avgWinner: avgWinnerHold, avgLoser: avgLoserHold },
      streaks: { maxWin, maxLoss, current: curStreak },
      monthlyPnl,
      keishaAccuracy: {
        agreed: agreed.length,
        disagreed: disagreed.length,
        agreedAndRight: agreedAndRight.length,
        disagreedAndRight: disagreedAndRight.length,
      },
      bestTrade,
      worstTrade,
      recentPerformance: { last10Trades: last10, last30DaysPnl: Math.round(last30DaysPnl * 100) / 100 },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
