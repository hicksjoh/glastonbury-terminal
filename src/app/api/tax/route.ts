import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';

export async function GET() {
  const rl = rateLimit('tax-main', 30, 60000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const supabase = createServiceClient();
    const currentYear = new Date().getFullYear();

    const { data: events } = await supabase
      .from('tax_events')
      .select('*')
      .gte('date', `${currentYear}-01-01`)
      .lte('date', `${currentYear}-12-31`)
      .order('date', { ascending: false });

    const taxEvents = events || [];

    const shortTermGains = taxEvents
      .filter(e => e.event_type === 'realized_gain' && e.tax_character === 'short_term')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const longTermGains = taxEvents
      .filter(e => e.event_type === 'realized_gain' && e.tax_character === 'long_term')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const harvestedLosses = taxEvents
      .filter(e => e.event_type === 'realized_loss')
      .reduce((sum, e) => sum + Math.abs(Number(e.amount)), 0);

    const dividendIncome = taxEvents
      .filter(e => e.event_type === 'dividend')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const royaltyIncome = taxEvents
      .filter(e => e.event_type === 'royalty_income')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const rsuVests = taxEvents
      .filter(e => e.event_type === 'rsu_vest')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    // Simplified tax calculation
    const totalIncome = shortTermGains + longTermGains + dividendIncome + royaltyIncome + rsuVests - harvestedLosses;
    const federalRate = totalIncome > 243725 ? 0.35 : totalIncome > 191950 ? 0.32 : 0.24;
    const caStateRate = 0.133;
    const niitRate = totalIncome > 250000 ? 0.038 : 0;
    const ltcgRate = 0.20;

    const federalTax = (shortTermGains - harvestedLosses + dividendIncome + royaltyIncome + rsuVests) * federalRate + longTermGains * ltcgRate;
    const stateTax = totalIncome * caStateRate;
    const niit = (shortTermGains + longTermGains + dividendIncome) * niitRate;
    const estimatedTotal = Math.max(0, federalTax + stateTax + niit);
    const qbiDeduction = royaltyIncome * 0.20;

    const washSales = taxEvents.filter(e => e.wash_sale_flag);

    return NextResponse.json({
      success: true,
      data: {
        ytd_short_term_gains: shortTermGains,
        ytd_long_term_gains: longTermGains,
        ytd_harvested_losses: harvestedLosses,
        ytd_dividend_income: dividendIncome,
        ytd_royalty_income: royaltyIncome,
        ytd_rsu_vests: rsuVests,
        qbi_deduction: qbiDeduction,
        estimated_quarterly_liability: estimatedTotal / 4,
        estimated_annual_liability: estimatedTotal,
        federal_rate: federalRate,
        state_rate: caStateRate,
        niit_rate: niitRate,
        wash_sales: washSales,
        events: taxEvents,
      },
    });
  } catch (error) {
    console.error('Tax API error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch tax data' }, { status: 500 });
  }
}
