import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// GET: List all conversations, optionally filtered by persona
export async function GET(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations' });
  try {
    const supabase = createServiceClient();
    const persona = req.nextUrl.searchParams.get('persona');

    let query = supabase
      .from('keisha_chat_sessions')
      .select('id, persona, title, messages_json, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (persona) {
      query = query.eq('persona', persona);
    }

    const { data, error } = await query;

    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'list' });
      log.error({ err: error.message, sentry_event_id: eventId }, 'list conversations failed');
      return NextResponse.json({ error: 'Failed to list conversations', sentry_event_id: eventId }, { status: 500 });
    }

    // Return with a preview of the last message
    const conversations = (data || []).map((c: any) => {
      const messages = c.messages_json || [];
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      return {
        id: c.id,
        persona: c.persona,
        title: c.title || (lastMsg?.content?.slice(0, 60) + '...') || 'New Conversation',
        preview: lastMsg?.content?.slice(0, 100) || '',
        messageCount: messages.length,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'list' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'list conversations threw');
    return NextResponse.json({ error: 'Failed to list conversations', sentry_event_id: eventId }, { status: 500 });
  }
}

// POST: Create a new conversation
export async function POST(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations' });
  try {
    const supabase = createServiceClient();
    const { persona, title } = await req.json();

    const { data, error } = await supabase
      .from('keisha_chat_sessions')
      .insert({
        persona: persona || 'general',
        title: title || null,
        messages_json: [],
      })
      .select('id, persona, title, created_at, updated_at')
      .single();

    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'create' });
      log.error({ err: error.message, sentry_event_id: eventId }, 'create conversation failed');
      return NextResponse.json({ error: 'Failed to create conversation', sentry_event_id: eventId }, { status: 500 });
    }

    return NextResponse.json({ conversation: data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'create' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'create conversation threw');
    return NextResponse.json({ error: 'Failed to create conversation', sentry_event_id: eventId }, { status: 500 });
  }
}

// DELETE: Delete all conversations for a persona
export async function DELETE(req: NextRequest) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations' });
  try {
    const supabase = createServiceClient();
    const persona = req.nextUrl.searchParams.get('persona');

    if (!persona) {
      return NextResponse.json({ error: 'persona query param required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('keisha_chat_sessions')
      .delete()
      .eq('persona', persona);

    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'delete', persona });
      log.error({ err: error.message, sentry_event_id: eventId }, 'delete conversations failed');
      return NextResponse.json({ error: 'Failed to delete conversations', sentry_event_id: eventId }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations', stage: 'delete' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'delete conversations threw');
    return NextResponse.json({ error: 'Failed to delete conversations', sentry_event_id: eventId }, { status: 500 });
  }
}
