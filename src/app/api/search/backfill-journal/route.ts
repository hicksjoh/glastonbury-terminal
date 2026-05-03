import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitDurable } from '@/lib/rate-limit-durable';
import { createServiceClient } from '@/lib/supabase';
import { indexDoc } from '@/lib/doc-indexer';
import { isEmbeddingConfigured } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type JournalRow = {
  id: string;
  ticker: string | null;
  direction: string | null;
  strategy: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  pnl: number | null;
  notes: string | null;
};

function buildContent(row: JournalRow): string {
  const parts: string[] = [];
  parts.push(`Ticker: ${row.ticker ?? 'n/a'}`);
  if (row.direction) parts.push(`Direction: ${row.direction}`);
  if (row.strategy) parts.push(`Strategy: ${row.strategy}`);
  if (row.entry_date) parts.push(`Entry date: ${row.entry_date}${row.entry_price ? ` @ $${row.entry_price}` : ''}`);
  if (row.exit_date) parts.push(`Exit date: ${row.exit_date}${row.exit_price ? ` @ $${row.exit_price}` : ''}`);
  if (row.pnl != null) parts.push(`P&L: $${row.pnl}`);
  if (row.notes) parts.push(`\nNotes:\n${row.notes}`);
  return parts.join('\n');
}

// POST /api/search/backfill-journal  — re-index every trade_journal row as doc_chunks.
export async function POST(_req: NextRequest) {
  // P0-6: bulk embeddings — 3 / 5 min global durable cap.
  const { allowed } = await checkRateLimitDurable('backfill-journal', 'global', 3, 300);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const cfg = isEmbeddingConfigured();
  if (!cfg.ready) {
    return NextResponse.json(
      { error: 'Embeddings unconfigured — set VOYAGE_API_KEY or OPENAI_API_KEY' },
      { status: 503 },
    );
  }

  try {
    const sb = createServiceClient();
    const { data, error } = await sb
      .from('trade_journal')
      .select('id, ticker, direction, strategy, entry_date, exit_date, entry_price, exit_price, pnl, notes');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data as unknown as JournalRow[]) ?? [];
    if (rows.length === 0) return NextResponse.json({ indexed: 0, total: 0 });

    let indexed = 0;
    let chunks = 0;
    const failures: string[] = [];
    for (const r of rows) {
      const content = buildContent(r);
      if (content.trim().length < 20) continue;
      try {
        const result = await indexDoc({
          doc_type: 'journal',
          source_id: r.id,
          content,
          ticker: r.ticker || null,
          metadata: { entry_date: r.entry_date, pnl: r.pnl },
        });
        indexed += 1;
        chunks += result.inserted;
      } catch (err) {
        failures.push(`${r.id}: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      indexed,
      chunks,
      total: rows.length,
      provider: cfg.provider,
      failures: failures.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
