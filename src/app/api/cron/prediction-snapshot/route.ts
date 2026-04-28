import { NextRequest, NextResponse } from 'next/server';
import { takePredictionSnapshot } from '@/lib/prediction-markets';
import { pingHealthcheck } from '@/lib/healthchecks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HC_SLUG = 'cron-prediction-snapshot';

async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get('authorization') ?? '';
    const headerKey = req.headers.get('x-api-key') ?? '';
    const ok = header === `Bearer ${cronSecret}` || headerKey === cronSecret;
    const hasCookieAuth = !!req.cookies.get('gt-auth');
    if (!ok && !hasCookieAuth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await pingHealthcheck(HC_SLUG, 'start');

  try {
    const result = await takePredictionSnapshot();
    await pingHealthcheck(HC_SLUG, 'success');
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      summary: result.deltas.map(d => ({
        source: d.source,
        ticker: d.market_ticker,
        name: d.market_name.slice(0, 80),
        yes: d.yes_price,
        delta_24h: d.delta_24h,
      })),
    });
  } catch (err) {
    await pingHealthcheck(HC_SLUG, 'fail');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
