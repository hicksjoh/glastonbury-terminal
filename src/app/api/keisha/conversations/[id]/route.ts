import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { captureRouteError } from '@/lib/api-error';
import { loggerFor } from '@/lib/request-id';

// GET: Fetch full conversation by ID
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations/[id]' });
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('keisha_chat_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      // Probably "not found" — log at info level, don't bother Sentry.
      log.info({ conv_id: id, supabase_err: error.message }, 'conversation lookup miss');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ conversation: data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations/[id]', stage: 'get' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'conversation get threw');
    return NextResponse.json({ error: 'Failed to fetch conversation', sentry_event_id: eventId }, { status: 500 });
  }
}

// PUT: Update conversation (add messages, update title)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations/[id]' });
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    const body = await req.json();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.messages_json !== undefined) {
      updates.messages_json = body.messages_json;
    }

    if (body.title !== undefined) {
      updates.title = body.title;
    }

    const { data, error } = await supabase
      .from('keisha_chat_sessions')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations/[id]', stage: 'put', conv_id: id });
      log.error({ err: error.message, sentry_event_id: eventId }, 'conversation update failed');
      return NextResponse.json({ error: 'Failed to update conversation', sentry_event_id: eventId }, { status: 500 });
    }

    return NextResponse.json({ conversation: data });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations/[id]', stage: 'put' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'conversation put threw');
    return NextResponse.json({ error: 'Failed to update conversation', sentry_event_id: eventId }, { status: 500 });
  }
}

// DELETE: Delete a single conversation
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { log, request_id } = loggerFor(req, { route: 'keisha/conversations/[id]' });
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { error } = await supabase
      .from('keisha_chat_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations/[id]', stage: 'delete', conv_id: id });
      log.error({ err: error.message, sentry_event_id: eventId }, 'conversation delete failed');
      return NextResponse.json({ error: 'Failed to delete conversation', sentry_event_id: eventId }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const eventId = captureRouteError(error, { request_id, route: 'keisha/conversations/[id]', stage: 'delete' });
    log.error({ err: error instanceof Error ? error.message : String(error), sentry_event_id: eventId }, 'conversation delete threw');
    return NextResponse.json({ error: 'Failed to delete conversation', sentry_event_id: eventId }, { status: 500 });
  }
}
