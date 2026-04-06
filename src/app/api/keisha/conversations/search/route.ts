import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim();
  const persona = searchParams.get('persona');

  if (!query || query.length < 2) {
    return NextResponse.json({ conversations: [] });
  }

  try {
    const supabase = createServiceClient();

    // Search across conversation titles and message content
    let dbQuery = supabase
      .from('keisha_chat_sessions')
      .select('id, persona, title, messages_json, created_at, updated_at')
      .or(`title.ilike.%${query}%,messages_json::text.ilike.%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (persona) {
      dbQuery = dbQuery.eq('persona', persona);
    }

    const { data, error } = await dbQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Format results with search context (show matching snippet)
    const conversations = (data || []).map((c: any) => {
      const msgs = c.messages_json || [];
      const matchingMsg = msgs.find((m: any) =>
        m.content?.toLowerCase().includes(query.toLowerCase())
      );

      return {
        id: c.id,
        persona: c.persona,
        title: c.title || 'Untitled',
        preview: matchingMsg?.content?.slice(0, 120) || c.title || '',
        messageCount: msgs.length,
        created_at: c.created_at,
        updated_at: c.updated_at,
        matchSnippet: matchingMsg ? highlightMatch(matchingMsg.content, query) : null,
      };
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

function highlightMatch(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 120);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}
