import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function GET_impl() {
  try {
    const supabase = createServiceClient();
    const [{ data: items, error: itemsError }, { data: cashAssets }] = await Promise.all([
      supabase.from('cashflow_items').select('*').order('date', { ascending: true }),
      // Opening balance comes from the authoritative cash rows. It used to be
      // the literal `75000`, so every projected balance, the runway figure and
      // the cash-crunch warning descended from a constant that had nothing to
      // do with the actual account.
      supabase.from('wealth_assets').select('current_value').eq('asset_class', 'cash'),
    ]);

    if (itemsError) {
      return NextResponse.json(
        { success: false, error: 'Cashflow store unavailable' },
        { status: 503 },
      );
    }

    const cashflowItems = items || [];

    // null (not 0) when no cash row exists — "unknown opening balance" must not
    // masquerade as "starts at zero", and it suppresses the balance/runway
    // projection rather than producing a confident wrong number.
    const openingCash: number | null = Array.isArray(cashAssets) && cashAssets.length > 0
      ? cashAssets.reduce((sum, a) => sum + (Number(a.current_value) || 0), 0)
      : null;

    // Project 12 months forward
    const now = new Date();
    const months: { month: string; inflows: number; outflows: number; net: number; balance: number; items: typeof cashflowItems }[] = [];
    let runningBalance = openingCash ?? 0;

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
    // Both of these are meaningless without a real opening balance.
    const runway = openingCash != null && monthlyBurnRate > 0
      ? Math.round(runningBalance / monthlyBurnRate)
      : null;
    const crunchMonth = openingCash != null ? months.find(m => m.balance < 25000) : undefined;

    return NextResponse.json({
      success: true,
      data: {
        current_cash: openingCash,
        /** false => balances/runway are not projectable; show flows only. */
        opening_balance_known: openingCash != null,
        monthly_burn_rate: monthlyBurnRate,
        runway_months: runway,
        total_inflows_12m: totalInflows,
        total_outflows_12m: totalOutflows,
        months: months.map(m => ({
          ...m,
          // Balance is only meaningful relative to a known starting point.
          balance: openingCash != null ? m.balance : null,
        })),
        cash_crunch: crunchMonth ? { month: crunchMonth.month, balance: crunchMonth.balance } : null,
      },
    });
  } catch (error) {
    console.error('Cashflow API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch cashflow data' }, { status: 500 });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('cashflow', RATE.UPSTREAM, GET_impl);
