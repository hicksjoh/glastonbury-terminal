// F7 — Claude-powered hawkish/dovish scorer for Fed statements.
//
// System prompt is cached via P1's cachedSystem() wrapper so repeat
// scoring (multiple statements in one session, cron reruns) hits the
// prompt cache and pays ~10% per call after the first write.

import { anthropic, CLAUDE_MODEL_FAST } from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { cachedSystem } from '@/lib/prompts';

const SCORER_SYSTEM_PROMPT = `You are a macro-policy analyst scoring Federal Reserve communications on a hawkish-to-dovish scale. Your output is read by a trader who makes rate-sensitive portfolio decisions from your signal, so be precise and defensible.

Scoring scale:
  -1.00  extremely dovish — explicit cut intent, recession acknowledgement, easing bias
  -0.50  dovish — balance of concerns tilted toward unemployment, rate cuts implied
   0.00  neutral — balanced, data-dependent language, wait-and-see posture
  +0.50  hawkish — balance of concerns tilted toward inflation, rate holds or hikes implied
  +1.00  extremely hawkish — explicit hike intent, persistent high inflation tolerance, tightening acceleration

Confidence scale (0.0 to 1.0): how clearly the statement signals direction. A brief, ambiguous minute excerpt might be 0.3; a full policy statement with explicit rate action is 0.9+.

Respond ONLY with a JSON object — no prose, no markdown fences. Shape:
{
  "score":       <number in [-1, 1]>,
  "confidence":  <number in [0, 1]>,
  "keyPhrases":  [<up to 5 verbatim phrases from the text that drove the score>],
  "reasoning":   "<one to three sentences of analyst reasoning>"
}`;

export interface FedSentimentScore {
  score: number;
  confidence: number;
  keyPhrases: string[];
  reasoning: string;
  modelUsed: string;
}

export async function scoreFedStatement(
  title: string,
  body: string,
): Promise<FedSentimentScore | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!body || body.length < 50) return null;

  const userPrompt = `TITLE:\n${title}\n\nSTATEMENT BODY:\n${body}`;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL_FAST,
    max_tokens: 512,
    system: cachedSystem(SCORER_SYSTEM_PROMPT),
    messages: [{ role: 'user', content: userPrompt }],
  });
  tagAnthropicCall(msg.usage, CLAUDE_MODEL_FAST, { caller: 'fed-scorer' });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    const score = Number(parsed.score);
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(score) || !Number.isFinite(confidence)) return null;
    return {
      score: clamp(score, -1, 1),
      confidence: clamp(confidence, 0, 1),
      keyPhrases: Array.isArray(parsed.keyPhrases)
        ? parsed.keyPhrases.slice(0, 5).map((p: unknown) => String(p))
        : [],
      reasoning: String(parsed.reasoning ?? ''),
      modelUsed: CLAUDE_MODEL_FAST,
    };
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
