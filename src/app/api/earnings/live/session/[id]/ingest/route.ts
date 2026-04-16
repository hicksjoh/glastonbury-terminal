import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { chunkTranscript, fetchFmpTranscript, insertChunks, transcribeAudioFile } from '@/lib/earnings-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// POST /api/earnings/live/session/[id]/ingest
//   Three ingest paths selected by `action`:
//     action="paste" | body: { text: string }
//     action="fmp"   | body: { year: number, quarter: number }      (uses session.ticker)
//     action="whisper" | multipart form with "audio" File
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  const { allowed } = rateLimit('earnings-ingest', 60, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    const sb = createServiceClient();
    const { data: session, error: sErr } = await sb
      .from('earnings_sessions').select('ticker, status').eq('id', id).single();
    if (sErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const contentType = req.headers.get('content-type') ?? '';

    // Whisper (multipart)
    if (contentType.startsWith('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
      }
      const text = await transcribeAudioFile(file);
      if (!text) {
        return NextResponse.json({ error: 'Whisper transcription failed (OPENAI_API_KEY may be unset)' }, { status: 503 });
      }
      const chunks = chunkTranscript(text);
      const inserted = await insertChunks(id, chunks);
      return NextResponse.json({ inserted, transcript_preview: text.slice(0, 300) });
    }

    // JSON paths
    const body = await req.json() as { action?: string; text?: string; year?: number; quarter?: number };
    const action = body.action ?? 'paste';

    if (action === 'paste') {
      const text = (body.text ?? '').trim();
      if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 });
      const chunks = chunkTranscript(text);
      const inserted = await insertChunks(id, chunks);
      return NextResponse.json({ inserted });
    }

    if (action === 'fmp') {
      const year = Number(body.year);
      const quarter = Number(body.quarter);
      if (!year || !quarter) {
        return NextResponse.json({ error: 'Need year and quarter' }, { status: 400 });
      }
      const ticker = (session as unknown as { ticker: string }).ticker;
      const t = await fetchFmpTranscript(ticker, year, quarter);
      if (!t) return NextResponse.json({ error: 'FMP transcript unavailable for that ticker/quarter' }, { status: 404 });
      const chunks = chunkTranscript(t.content);
      const inserted = await insertChunks(id, chunks);
      // Stash quarter + source on the session
      await sb.from('earnings_sessions').update({
        quarter: `${t.year} Q${t.quarter}`,
        call_date: t.date || new Date().toISOString().slice(0, 10),
      }).eq('id', id);
      return NextResponse.json({ inserted, source: 'fmp', quarter: t.quarter, year: t.year, date: t.date });
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
