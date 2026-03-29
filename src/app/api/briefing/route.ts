import { NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/claude';
import { PORTFOLIO_SUMMARY } from '@/lib/data';

export async function GET() {
  try {
    const context = `Net worth: $${PORTFOLIO_SUMMARY.totalNetWorth.toLocaleString()}. CR3 equity: $${PORTFOLIO_SUMMARY.cr3Equity.toLocaleString()}. Investment portfolio: $${(PORTFOLIO_SUMMARY.alpacaEquity + PORTFOLIO_SUMMARY.alpacaCash).toLocaleString()}.`;
    const briefing = await generateBriefing(context);
    return NextResponse.json({ briefing, generatedAt: new Date().toISOString() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
