/**
 * Phase 4 — Earnings call co-pilot engine.
 * Chunking, sentiment scoring (Haiku), FMP transcript importer, memo generator (Opus).
 */

import { anthropic, CLAUDE_MODEL_PRIMARY, CLAUDE_MODEL_FAST } from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { createServiceClient } from '@/lib/supabase';

// ── Chunking ────────────────────────────────────────────────────────────────
// Split free-form transcript text into speaker-tagged paragraphs.
// Accepts two common shapes: "Speaker: …" line-prefixed, or long paragraphs.
export type RawChunk = { speaker: string | null; text: string };

export function chunkTranscript(raw: string): RawChunk[] {
  if (!raw) return [];
  // Normalize whitespace, drop stage-direction bracketing like [Music]
  const cleaned = raw.replace(/\[[^\]]{1,60}\]/g, '').trim();

  // Split into speaker-prefixed paragraphs where possible.
  // Pattern: line-start, Name (may contain spaces/periods/dots), colon, text.
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const chunks: RawChunk[] = [];
  let current: RawChunk | null = null;
  const speakerRe = /^([A-Z][A-Za-z.'\- ]{1,60}?):\s*(.*)$/;

  for (const line of lines) {
    const m = line.match(speakerRe);
    if (m) {
      if (current && current.text.trim()) chunks.push(current);
      current = { speaker: m[1].trim(), text: m[2].trim() };
    } else if (current) {
      current.text += (current.text ? ' ' : '') + line;
    } else {
      current = { speaker: null, text: line };
    }
  }
  if (current && current.text.trim()) chunks.push(current);

  // Split overly long chunks (> ~800 chars) on sentence boundary so sentiment
  // scoring has a reasonable granularity.
  const out: RawChunk[] = [];
  for (const c of chunks) {
    if (c.text.length <= 800) { out.push(c); continue; }
    const sentences = c.text.split(/(?<=[.!?])\s+/);
    let buf = '';
    for (const s of sentences) {
      if ((buf + ' ' + s).length > 800 && buf) {
        out.push({ speaker: c.speaker, text: buf.trim() });
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf.trim()) out.push({ speaker: c.speaker, text: buf.trim() });
  }
  return out;
}

// ── Sentiment scoring (Haiku for speed/cost) ────────────────────────────────
const SENTIMENT_SYSTEM = `You score short passages from corporate earnings calls.

Return ONLY a JSON array (no markdown fences) where each element maps to the SAME index as the input passage. Each object:
{
  "score": number,   // -1.0 very bearish, 0.0 neutral, +1.0 very bullish. Consider guidance tone, margin commentary, demand signals, confidence, and hedge language.
  "tags": string[]   // any of: "guidance_up","guidance_down","guidance_flat","margin_strength","margin_pressure","demand_strong","demand_weak","hedge","uncertainty","cost_pressure","pricing_power","buyback","beat","miss","capex_up","capex_down","competitive_threat","macro_headwind","macro_tailwind"
}

Be calibrated — most passages are neutral (score near 0). Reserve |score| > 0.6 for genuinely strong signals. Never invent tags that don't apply.`;

export type ScoredPassage = { score: number; tags: string[] };

export async function scorePassages(passages: string[]): Promise<ScoredPassage[]> {
  if (passages.length === 0) return [];
  const userPrompt = `Score these ${passages.length} passages from an earnings call. Return a JSON array of length ${passages.length}.

${passages.map((p, i) => `[${i}] ${p}`).join('\n\n')}`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL_FAST,
    max_tokens: 2000,
    system: SENTIMENT_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });
  tagAnthropicCall(msg.usage, CLAUDE_MODEL_FAST, { caller: 'earnings-engine.sentiment' });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonStr = arrMatch ? arrMatch[0] : cleaned;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return passages.map(() => ({ score: 0, tags: [] }));
    return parsed.slice(0, passages.length).map((r: { score?: unknown; tags?: unknown }) => ({
      score: Math.max(-1, Math.min(1, Number(r?.score) || 0)),
      tags: Array.isArray(r?.tags) ? r.tags.slice(0, 6).map(String) : [],
    }));
  } catch {
    return passages.map(() => ({ score: 0, tags: [] }));
  }
}

// ── FMP transcript import ──────────────────────────────────────────────────
export type FmpTranscript = { symbol: string; quarter: number; year: number; date: string; content: string };

export async function fetchFmpTranscript(ticker: string, year: number, quarter: number): Promise<FmpTranscript | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    // /stable/earning-call-transcript is a paid-tier endpoint on the current
    // plan (returns 402 Restricted Endpoint). We still attempt it so an
    // upgraded plan just starts working. 402/404 → null and callers degrade.
    const url = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${encodeURIComponent(ticker)}&year=${year}&quarter=${quarter}&apikey=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const t = body[0];
    if (t && typeof t.content === 'string') {
      return {
        symbol: String(t.symbol ?? ticker.toUpperCase()),
        quarter: Number(t.quarter ?? quarter),
        year: Number(t.year ?? year),
        date: String(t.date ?? ''),
        content: String(t.content),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── OpenAI Whisper transcription (optional — only if OPENAI_API_KEY is set) ─
export async function transcribeAudioFile(file: File): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

// ── Persistence helpers ─────────────────────────────────────────────────────
// Uses the append_earnings_chunks Postgres RPC (advisory-xact-lock per session)
// to prevent the concurrent-ingest seq collision found in adversarial QA. The
// RPC is atomic; the prior in-app read-max-then-increment was racy.
export async function insertChunks(sessionId: string, rawChunks: RawChunk[]): Promise<number> {
  if (rawChunks.length === 0) return 0;
  const sb = createServiceClient();
  const payload = rawChunks
    .filter(c => c.text && c.text.trim().length > 0)
    .map(c => ({ speaker: c.speaker ?? '', text: c.text }));
  if (payload.length === 0) return 0;
  const { data, error } = await sb.rpc('append_earnings_chunks', {
    p_session_id: sessionId,
    p_chunks: payload,
  });
  if (error) return 0;
  return Number(data) || 0;
}

// ── Memo generation ─────────────────────────────────────────────────────────
const MEMO_SYSTEM = `You are Keisha, Wes Hicks' senior trading analyst, writing a post-earnings-call memo.

You get the full transcript. Produce a sharp, number-dense memo. No filler, no corporate-speak. Cite exact numbers and specific sentences from the transcript.

Return ONLY a JSON object (no markdown fences) matching this exact shape:
{
  "memo_markdown": string,       // 400-700 words. Sections: Top-Line, Guidance, Margins, Demand Signals, Risk Flags, Next-Quarter Watch.
  "keisha_take": string,         // 2-4 sentences. Your synthesis. Direct. Warm. African American slang welcome.
  "guidance_delta": string,      // "up" | "down" | "flat" | "unclear" + one-sentence reason
  "key_quotes": [                // 3-6 quotes with speaker + a short rationale
    { "speaker": string, "quote": string, "why_it_matters": string }
  ]
}`;

export type MemoResult = {
  memo_markdown: string;
  keisha_take: string;
  guidance_delta: string;
  key_quotes: { speaker: string; quote: string; why_it_matters: string }[];
};

export async function generateMemo(args: { ticker: string; quarter: string | null; transcriptText: string }): Promise<MemoResult> {
  const user = `Ticker: ${args.ticker}
${args.quarter ? `Quarter: ${args.quarter}` : ''}

FULL TRANSCRIPT (may include operator / prepared remarks / Q&A):
${args.transcriptText.slice(0, 45_000)}

Write the post-call memo in the required JSON shape. Cite exact numbers and use real quotes from the transcript.`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL_PRIMARY,
    max_tokens: 3000,
    system: MEMO_SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  tagAnthropicCall(msg.usage, CLAUDE_MODEL_PRIMARY, { caller: 'earnings-engine.memo' });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = m ? m[0] : cleaned;
  try {
    const j = JSON.parse(jsonStr);
    return {
      memo_markdown: String(j.memo_markdown ?? '').slice(0, 8000),
      keisha_take: String(j.keisha_take ?? '').slice(0, 1000),
      guidance_delta: String(j.guidance_delta ?? '').slice(0, 400),
      key_quotes: Array.isArray(j.key_quotes) ? j.key_quotes.slice(0, 8).map((q: { speaker?: unknown; quote?: unknown; why_it_matters?: unknown }) => ({
        speaker: String(q.speaker ?? ''),
        quote: String(q.quote ?? ''),
        why_it_matters: String(q.why_it_matters ?? ''),
      })) : [],
    };
  } catch {
    return {
      memo_markdown: text.slice(0, 4000),
      keisha_take: '',
      guidance_delta: 'unclear',
      key_quotes: [],
    };
  }
}
