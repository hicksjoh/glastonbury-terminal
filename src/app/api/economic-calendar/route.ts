import { NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET() {
  try {
    if (!FMP_KEY) return NextResponse.json({ events: [] });

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 3);
    const to = new Date(today);
    to.setDate(to.getDate() + 14);

    const res = await fetch(
      `${FMP_BASE}/economic_calendar?from=${from.toISOString().split('T')[0]}&to=${to.toISOString().split('T')[0]}&apikey=${FMP_KEY}`
    );

    if (!res.ok) return NextResponse.json({ events: [] });
    const data = await res.json();

    return NextResponse.json({
      events: (data || []).map((e: Record<string, unknown>) => ({
        event: e.event,
        date: e.date,
        country: e.country,
        actual: e.actual,
        previous: e.previous,
        consensus: e.estimate,
        impact: e.impact,
      })),
    });
  } catch (error) {
    console.error('Econ calendar error:', error);
    return NextResponse.json({ events: [] });
  }
}
