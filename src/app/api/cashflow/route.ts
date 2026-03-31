import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data: items } = await supabase
      .from('cashflow_items')
      .select('*')
      .order('date', { ascending: true });

    const cashflowItems = items || [];

    // Project 12 months forward
    const now = new Date();
    const months: { month: string; inflows: number; outflows: number; net: number; balance: number; items: typeof cashflowItems }[] = [];
    let runningBalance = 75000; // Starting cash position

    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = date.toISOString().slice(0, 7);
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      // Get items for this month
      const monthItems = cashflowItems.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate.getFullYear() === date.getFullYear() && itemDate.getMonth() === date.getMonth();
      });

      // Also include recurring items
      const recurringItems = cashflowItems.filter(item => {
        if (!item.recurring) return false;
        const itemDate = new Date(item.date);
        if (itemDate > date) return false;
        if (item.recurring_interval === 'monthly') return true;
        if (item.recurring_interval === 'quarterly') return date.getMonth() % 3 === itemDate.getMonth() % 3;
        if (item.recurring_interval === 'annually') return date.getMonth() === itemDate.getMonth();
        return false;
      });

      const allItems = [...monthItems, ...recurringItems.filter(r => !monthItems.find(m => m.id === r.id))];

      const inflows = allItems.filter(i => i.type === 'inflow').reduce((sum, i) => sum + Number(i.amount), 0);
      const outflows = allItems.filter(i => i.type === 'outflow').reduce((sum, i) => sum + Math.abs(Number(i.amount)), 0);
      const net = inflows - outflows;
      runningBalance += net;

      months.push({
        month: monthLabel,
        inflows,
        outflows,
        net,
        balance: runningBalance,
        items: allItems,
      });
    }

    const totalInflows = months.reduce((sum, m) => sum + m.inflows, 0);
    const totalOutflows = months.reduce((sum, m) => sum + m.outflows, 0);
    const monthlyBurnRate = totalOutflows / 12;
    const runway = monthlyBurnRate > 0 ? Math.round(runningBalance / monthlyBurnRate) : 999;
    const crunchMonth = months.find(m => m.balance < 25000);

    return NextResponse.json({
      success: true,
      data: {
        current_cash: 75000,
        monthly_burn_rate: monthlyBurnRate,
        runway_months: runway,
        total_inflows_12m: totalInflows,
        total_outflows_12m: totalOutflows,
        months,
        cash_crunch: crunchMonth ? { month: crunchMonth.month, balance: crunchMonth.balance } : null,
      },
    });
  } catch (error) {
    console.error('Cashflow API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch cashflow data' }, { status: 500 });
  }
}
