/**
 * Cash Flow Projector
 * 12-month forward projection with 3 scenarios
 */

export interface CashflowItem {
  type: 'inflow' | 'outflow';
  category: string;
  description: string;
  amount: number;
  date: string;
  recurring: boolean;
  recurringInterval?: 'monthly' | 'quarterly' | 'annually';
}

export interface MonthProjection {
  month: string; // "Apr 2026"
  inflows: number;
  outflows: number;
  net: number;
  balance: number;
  items: CashflowItem[];
}

export interface CashflowProjection {
  months: MonthProjection[];
  totalInflows: number;
  totalOutflows: number;
  netCashflow: number;
  endingBalance: number;
  monthlyBurnRate: number;
  runway: number; // months until balance hits threshold
  crunchMonth: string | null; // First month below threshold
}

const BALANCE_THRESHOLD = 25000;

/**
 * Project cash flows forward 12 months
 */
export function projectCashflow(
  items: CashflowItem[],
  startingBalance: number,
  scenario: 'base' | 'optimistic' | 'conservative' = 'base',
): CashflowProjection {
  const inflowMultiplier = scenario === 'optimistic' ? 1.2 : scenario === 'conservative' ? 0.8 : 1.0;
  const outflowMultiplier = scenario === 'optimistic' ? 0.9 : scenario === 'conservative' ? 1.1 : 1.0;

  const now = new Date();
  const months: MonthProjection[] = [];
  let runningBalance = startingBalance;

  for (let i = 0; i < 12; i++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();

    // Find items for this month
    const monthItems: CashflowItem[] = [];

    for (const item of items) {
      const itemDate = new Date(item.date);

      // One-time items in this month
      if (!item.recurring && itemDate.getFullYear() === year && itemDate.getMonth() === month) {
        monthItems.push(item);
        continue;
      }

      // Recurring items
      if (item.recurring && itemDate <= monthDate) {
        if (item.recurringInterval === 'monthly') {
          monthItems.push(item);
        } else if (item.recurringInterval === 'quarterly' && month % 3 === itemDate.getMonth() % 3) {
          monthItems.push(item);
        } else if (item.recurringInterval === 'annually' && month === itemDate.getMonth()) {
          monthItems.push(item);
        }
      }
    }

    const inflows = monthItems
      .filter(i => i.type === 'inflow')
      .reduce((sum, i) => sum + Math.abs(i.amount) * inflowMultiplier, 0);

    const outflows = monthItems
      .filter(i => i.type === 'outflow')
      .reduce((sum, i) => sum + Math.abs(i.amount) * outflowMultiplier, 0);

    const net = inflows - outflows;
    runningBalance += net;

    months.push({
      month: monthLabel,
      inflows,
      outflows,
      net,
      balance: runningBalance,
      items: monthItems,
    });
  }

  const totalInflows = months.reduce((sum, m) => sum + m.inflows, 0);
  const totalOutflows = months.reduce((sum, m) => sum + m.outflows, 0);
  const monthlyBurnRate = totalOutflows / 12;
  const crunchMonth = months.find(m => m.balance < BALANCE_THRESHOLD);

  return {
    months,
    totalInflows,
    totalOutflows,
    netCashflow: totalInflows - totalOutflows,
    endingBalance: runningBalance,
    monthlyBurnRate,
    runway: monthlyBurnRate > 0 ? Math.floor(runningBalance / monthlyBurnRate) : 999,
    crunchMonth: crunchMonth?.month || null,
  };
}
