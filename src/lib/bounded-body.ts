// Bounded body readers.
//
// Codex finding (#3): public/billable routes parsed unbounded JSON via
// `await req.json()` with no upper limit. A malicious client could OOM
// the function by sending a multi-GB body, or just spike billing on
// metered Anthropic/ElevenLabs paths by sending huge payloads.
//
// Two helpers:
//   - readBoundedJson(req, maxBytes) — JSON request bodies
//   - readBoundedText(req, maxBytes) — raw body text (for form-encoded routes)
//
// Both:
//   1. Reject early if Content-Length header exceeds maxBytes (no read)
//   2. Stream-read the body with a byte counter so chunked encoding can't lie
//   3. Throw BodyTooLargeError on overflow (HTTP 413 at the route handler)
//   4. Throw SyntaxError on bad JSON (HTTP 400)
//
// Caller convention: catch BodyTooLargeError and return a 413; treat any
// other error as a 400 invalid body.

export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
    this.limit = limit;
  }
}

/**
 * Stream-read up to `maxBytes` and return the decoded UTF-8 string.
 * Throws BodyTooLargeError if the body would exceed maxBytes.
 */
export async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  // Fast path: declared Content-Length over the limit.
  const declared = req.headers.get('content-length');
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
  }

  const reader = req.body?.getReader();
  if (!reader) {
    // No body at all — return empty string. JSON.parse('') will throw, which
    // the caller turns into a 400. That's fine.
    return '';
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore — already over */ }
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  // Concatenate chunks → string. Most bodies are <100KB so this is cheap.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Stream-read up to `maxBytes` and return parsed JSON (typed as T).
 * Empty body → returns `{}` cast to T (callers re-validate via Zod anyway).
 *
 * Throws BodyTooLargeError on overflow, SyntaxError on bad JSON.
 */
export async function readBoundedJson<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const text = await readBoundedText(req, maxBytes);
  if (text.length === 0) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SyntaxError('Invalid JSON body');
  }
}

/** Suggested limits — keep callers consistent. */
export const BODY_LIMIT = {
  /** Tiny — single-field POSTs (login, finalize tx). */
  TINY: 1024,
  /** Small — most API request bodies. */
  SMALL: 8 * 1024,
  /** Medium — structured payloads with multiple sections (OAuth metadata, Keisha actions). */
  MEDIUM: 32 * 1024,
  /** Large — Keisha voice transcripts and conversation histories. */
  LARGE: 256 * 1024,
} as const;
