import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const APP_PASSWORD = process.env.APP_PASSWORD || 'glastonbury2026';

  if (password === APP_PASSWORD) {
    const res = NextResponse.json({ success: true });
    res.cookies.set('gt-auth', APP_PASSWORD, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
