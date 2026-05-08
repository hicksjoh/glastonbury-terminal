import { NextResponse } from 'next/server';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY || '';

export async function GET(request: Request) {
  const { log, request_id } = loggerFor(request, { route: 'economic-calendar' });
  try {
    if (!FMP_KEY) return NextResponse.json({ events: [] });

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 3);
    const to = new Date(today);
    to.setDate(to.getDate() + 14);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    // Use earnings-calendar (available on free tier) as the primary data source
    const res = await fetch(
      `${FMP_BASE}/earnings-calendar?from=${fromStr}&to=${toStr}&apikey=${FMP_KEY}`
    );

    if (!res.ok) return NextResponse.json({ events: [] });
    const data = await res.json();
    if (!Array.isArray(data)) return NextResponse.json({ events: [] });

    // Map earnings data to calendar event format
    const events = data.map((e: Record<string, unknown>) => {
      const epsEst = e.epsEstimated as number | null;
      const revEst = e.revenueEstimated as number | null;
      const epsActual = e.epsActual as number | null;

      return {
        event: `${e.symbol} Earnings`,
        date: e.date,
        country: 'US',
        actual: epsActual != null ? `EPS: $${epsActual.toFixed(2)}` : null,
        previous: null,
        consensus: epsEst != null ? `EPS Est: $${epsEst.toFixed(2)}` : null,
        impact: revEst && (revEst as number) > 10_000_000_000 ? 'High' : revEst && (revEst as number) > 1_000_000_000 ? 'Medium' : 'Low',
        symbol: e.symbol,
        revenueEstimated: revEst,
        revenueActual: e.revenueActual,
      };
    });

    return NextResponse.json({ events });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'economic-calendar' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'economic-calendar threw');
    return NextResponse.json({ events: [], sentry_event_id: eventId });
  }
}
