import { NextRequest, NextResponse } from 'next/server';

const ALPACA_DATA_URL = 'https://data.alpaca.markets';

export async function GET(req: NextRequest) {
  try {
    const limit = req.nextUrl.searchParams.get('limit') || '20';
    const symbols = req.nextUrl.searchParams.get('symbols') || '';

    const params = new URLSearchParams({
      limit,
      sort: 'desc',
    });
    if (symbols) {
      params.set('symbols', symbols);
    }

    const res = await fetch(`${ALPACA_DATA_URL}/v1beta1/news?${params}`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
      },
    });

    if (!res.ok) {
      console.error('Alpaca news error:', res.status);
      return NextResponse.json({ articles: [] });
    }

    const data = await res.json();
    const articles = (data.news || []).map((n: Record<string, unknown>) => ({
      headline: n.headline,
      summary: n.summary || '',
      source: n.source,
      url: n.url,
      symbols: n.symbols || [],
      created_at: n.created_at,
      image: (n.images as Array<{ url: string }> | undefined)?.[0]?.url || null,
    }));

    return NextResponse.json({ articles });
  } catch (error) {
    console.error('News error:', error);
    return NextResponse.json({ articles: [] });
  }
}
