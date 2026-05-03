import { NextRequest } from 'next/server';
import WebSocket from 'ws';
import {
  anthropic,
  CLAUDE_MODEL_PRIMARY,
  CLAUDE_MODEL_FALLBACK,
  CLAUDE_MODEL_FAST,
} from '@/lib/claude';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEISHA_VOICE_SYSTEM_PROMPT = `You are Keisha, Wes Hicks' senior trading analyst and COO, speaking out loud through voice mode in the Glastonbury Terminal.

Rules for voice:
- Conversational, direct, warm. Sound like a real person, not a chatbot.
- Short sentences. No markdown, no bullet points, no lists, no tables. You are being spoken aloud.
- Cite numbers when they matter, but say them the way a human would (say "five-eighty K" not "$580,000").
- Use African American slang naturally when it fits. Be fly without forcing it.
- Information, not financial advice. You inform Wes; you don't tell him what to do with his money.
- Keep responses under 120 words unless Wes explicitly asks for detail.`;

const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Bella — stand-in default
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
const ELEVEN_OUTPUT_FORMAT = 'mp3_44100_128';

type ClientRequestBody = {
  transcript: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
};

function sseEncode(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function openElevenLabsSocket(): WebSocket {
  const url =
    `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}/stream-input` +
    `?model_id=${ELEVEN_MODEL}&output_format=${ELEVEN_OUTPUT_FORMAT}&auto_mode=true`;
  return new WebSocket(url, {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' },
  });
}

export async function POST(req: NextRequest) {
  // P0-6: durable, session-keyed limit (Claude + ElevenLabs both bill).
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('keisha-voice', key, 30, 300);
  if (!allowed) return new Response('Too many requests', { status: 429 });

  if (!process.env.ELEVENLABS_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: ClientRequestBody;
  try {
    body = (await req.json()) as ClientRequestBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const transcript = (body.transcript ?? '').trim();
  if (!transcript) return new Response('Empty transcript', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEncode(obj))); } catch { /* controller closed */ }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      const abort = req.signal;
      let elevenWs: WebSocket | null = null;
      let claudeStream: ReturnType<typeof anthropic.messages.stream> | null = null;

      const cleanup = () => {
        try { claudeStream?.abort(); } catch { /* noop */ }
        try {
          if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
            elevenWs.send(JSON.stringify({ text: '' })); // flush/close
            elevenWs.close();
          } else if (elevenWs) {
            elevenWs.terminate();
          }
        } catch { /* noop */ }
        safeClose();
      };

      abort.addEventListener('abort', cleanup, { once: true });

      try {
        // ── 1. Open ElevenLabs WS ────────────────────────────────────
        elevenWs = openElevenLabsSocket();

        const elevenReady = new Promise<void>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('ElevenLabs WS open timeout')), 5000);
          elevenWs!.once('open', () => { clearTimeout(to); resolve(); });
          elevenWs!.once('error', err => { clearTimeout(to); reject(err); });
        });

        elevenWs.on('message', (raw: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(raw.toString()) as {
              audio?: string | null;
              isFinal?: boolean;
              normalizedAlignment?: unknown;
              alignment?: unknown;
            };
            if (parsed.audio) {
              send({ type: 'audio', chunk: parsed.audio });
            }
            if (parsed.isFinal) {
              send({ type: 'audio_done' });
            }
          } catch {
            /* non-JSON frame — skip */
          }
        });

        elevenWs.on('error', (err: Error) => {
          send({ type: 'error', source: 'elevenlabs', message: err.message });
        });

        await elevenReady;

        // Bootstrap ElevenLabs session (voice settings must be sent first)
        elevenWs.send(
          JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
            generation_config: {
              chunk_length_schedule: [120, 160, 250, 290],
            },
            xi_api_key: process.env.ELEVENLABS_API_KEY,
          }),
        );

        send({ type: 'meta', voiceId: ELEVEN_VOICE_ID, elevenModel: ELEVEN_MODEL });

        // ── 2. Start Claude streaming (with fallback) ────────────────
        const messages = [
          ...(body.history ?? []).slice(-8),
          { role: 'user' as const, content: transcript },
        ];

        const startClaude = (model: string) =>
          anthropic.messages.stream({
            model,
            max_tokens: 600,
            system: KEISHA_VOICE_SYSTEM_PROMPT,
            messages,
          });

        let modelUsed = CLAUDE_MODEL_PRIMARY;
        try {
          claudeStream = startClaude(CLAUDE_MODEL_PRIMARY);
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 429 || status === 529 || status === 503) {
            modelUsed = CLAUDE_MODEL_FALLBACK;
            claudeStream = startClaude(CLAUDE_MODEL_FALLBACK);
          } else if (status === 401 || status === 403) {
            // auth error — try fast model as last resort (still invalid, but fails fast)
            modelUsed = CLAUDE_MODEL_FAST;
            claudeStream = startClaude(CLAUDE_MODEL_FAST);
          } else {
            throw err;
          }
        }

        send({ type: 'model', model: modelUsed });

        claudeStream.on('text', (delta: string) => {
          send({ type: 'text', delta });
          if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
            try {
              elevenWs.send(JSON.stringify({ text: delta }));
            } catch { /* WS may have closed */ }
          }
        });

        claudeStream.on('error', (err: Error) => {
          send({ type: 'error', source: 'claude', message: err.message });
        });

        await claudeStream.finalMessage();

        // ── 3. Signal end-of-input to ElevenLabs ─────────────────────
        if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
          elevenWs.send(JSON.stringify({ text: '' })); // empty text = flush & close
        }

        // Wait for ElevenLabs to close on its own (isFinal received) with a timeout
        await new Promise<void>(resolve => {
          const to = setTimeout(resolve, 6000);
          elevenWs?.once('close', () => { clearTimeout(to); resolve(); });
        });

        send({ type: 'done', model: modelUsed });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        send({ type: 'error', source: 'server', message });
      } finally {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
