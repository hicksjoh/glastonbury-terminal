import { NextRequest, NextResponse } from 'next/server';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'portfolio-history' });
  try {
    const period = req.nextUrl.searchParams.get('period') || '1M';

    const periodMap: Record<string, string> = {
      '1W': '1W',
      '1M': '1M',
      '3M': '3M',
      '1Y': '1A',
      'ALL': '5A',
    };

    const timeframeMap: Record<string, string> = {
      '1W': '1D',
      '1M': '1D',
      '3M': '1D',
      '1Y': '1D',
      'ALL': '1D',
    };

    const alpacaPeriod = periodMap[period] || '1M';
    const alpacaTimeframe = timeframeMap[period] || '1D';

    const res = await fetch(
      `${ALPACA_BASE}/v2/account/portfolio/history?period=${alpacaPeriod}&timeframe=${alpacaTimeframe}`,
      {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
        },
      }
    );

    if (!res.ok) {
      log.warn({ status: res.status }, 'portfolio-history non-2xx from Alpaca');
      return NextResponse.json({ history: [] });
    }

    const data = await res.json();

    const history = (data.timestamp || []).map((ts: number, i: number) => ({
      timestamp: ts * 1000,
      equity: data.equity[i],
      profit_loss: data.profit_loss[i],
      profit_loss_pct: data.profit_loss_pct[i],
    }));

    return NextResponse.json({ history });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'portfolio-history' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'portfolio-history threw');
    return NextResponse.json({ history: [], sentry_event_id: eventId });
  }
}
