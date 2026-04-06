import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

function hashToken(password: string): string {
  return createHash('sha256').update(`gt:${password}`).digest('hex');
}

export async function POST(req: NextRequest) {
  const { allowed } = rateLimit('login', 5, 60000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const { password } = await req.json();
    const APP_PASSWORD = process.env.APP_PASSWORD || 'glastonbury2026';

    if (password === APP_PASSWORD) {
      const token = hashToken(APP_PASSWORD);
      const res = NextResponse.json({ success: true });
      res.cookies.set('gt-auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return res;
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
