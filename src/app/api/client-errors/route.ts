import { NextRequest, NextResponse } from 'next/server';
import { appendDurableCapped, getDurable } from '@/lib/durable-cache';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'client-errors:recent';
const MAX_ERRORS = 50;
const HOUR_MS = 60 * 60 * 1000;

export interface ClientErrorRecord {
  label: string;
  message: string;
  path: string;
  ts: string;
}

function isClientErrorRecord(value: unknown): value is ClientErrorRecord {
  if (!value || typeof value !== 'object') return false;
  const error = value as Record<string, unknown>;
  return typeof error.label === 'string'
    && typeof error.message === 'string'
    && typeof error.path === 'string'
    && typeof error.ts === 'string'
    && Number.isFinite(new Date(error.ts).getTime());
}

async function readErrors(): Promise<ClientErrorRecord[]> {
  const stored = await getDurable<unknown>(CACHE_KEY);
  return Array.isArray(stored) ? stored.filter(isClientErrorRecord) : [];
}

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('client-errors-post', 30, HOUR_MS);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const body: unknown = await req.json();
    if (!isClientErrorRecord(body)) {
      return NextResponse.json({ error: 'Invalid client error' }, { status: 400 });
    }

    const error: ClientErrorRecord = {
      label: body.label.slice(0, 100),
      message: body.message.slice(0, 2_000),
      path: body.path.slice(0, 500),
      ts: body.ts,
    };
    // Atomic prepend+trim in Postgres — concurrent crash beacons from
    // different lambdas must not clobber each other's entries.
    const saved = await appendDurableCapped(CACHE_KEY, error, MAX_ERRORS);
    if (!saved) return NextResponse.json({ error: 'Failed to store client error' }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function GET() {
  const { allowed } = rateLimit('client-errors-get', 30, HOUR_MS);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const errors = await readErrors();
  const cutoff = Date.now() - 24 * HOUR_MS;
  const count24h = errors.filter(error => new Date(error.ts).getTime() >= cutoff).length;
  return NextResponse.json({ errors, count24h });
}
