import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';
import { tagAnthropicCall } from '@/lib/anthropic-cost';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimitDurable, getRateLimitIdentity } from '@/lib/rate-limit-durable';
import { loggerFor } from '@/lib/request-id';
import { earningsToneQuerySchema } from './schema';

const FMP_KEY = process.env.FMP_API_KEY;

// Codex round-3 P1 — earnings-tone accepted raw `symbol`, `quarter`, `year`
// straight into a Supabase query, an FMP URL, and a Claude prompt. The
// schema (in ./schema.ts because Next 14 Route Handlers can't export Zod
// objects from route.ts itself) tightens those inputs.

function getCurrentQuarter(): number {
  const month = new Date().getMonth(); // 0-indexed
  return Math.floor(month / 3) + 1;
}

function fallbackKeywordAnalysis(transcript: string, symbol: string, quarter: number, year: number) {
  const lower = transcript.toLowerCase();

  const bullishWords = ['growth', 'strong', 'exceeded', 'beat', 'record', 'momentum', 'accelerating', 'outperform', 'upside', 'optimistic', 'confident', 'raising guidance', 'tailwind'];
  const bearishWords = ['decline', 'headwind', 'challenging', 'miss', 'below', 'weakness', 'deteriorating', 'uncertain', 'risk', 'pressure', 'restructuring', 'cutting', 'lowering guidance'];
  const defensiveWords = ['let me clarify', 'i want to be clear', 'as i said', 'to reiterate', 'one-time', 'non-recurring', 'temporary'];

  const bullishCount = bullishWords.filter(w => lower.includes(w)).length;
  const bearishCount = bearishWords.filter(w => lower.includes(w)).length;
  const defensiveCount = defensiveWords.filter(w => lower.includes(w)).length;

  const netSentiment = bullishCount - bearishCount;
  const overallTone = Math.max(1, Math.min(10, 5 + netSentiment));
  const tradingImplication = netSentiment > 2 ? 'bullish' : netSentiment < -2 ? 'bearish' : 'neutral';

  return {
    overallTone,
    confidence: 4, // low confidence for keyword-based
    guidanceTone: overallTone,
    defensiveness: Math.max(1, Math.min(10, defensiveCount * 2 + 1)),
    languageShift: netSentiment > 1 ? 'improving' : netSentiment < -1 ? 'deteriorating' : 'stable' as 'improving' | 'stable' | 'deteriorating',
    redFlags: bearishWords.filter(w => lower.includes(w)).slice(0, 3).map(w => `Keyword detected: "${w}"`),
    bullishSignals: bullishWords.filter(w => lower.includes(w)).slice(0, 3).map(w => `Keyword detected: "${w}"`),
    keyQuotes: [] as { quote: string; significance: string }[],
    summary: `Keyword-based analysis (Claude unavailable): Found ${bullishCount} bullish and ${bearishCount} bearish signals in ${symbol} Q${quarter} ${year} transcript.`,
    tradingImplication,
    conviction: 3,
  };
}

export async function GET(req: NextRequest) {
  const { log } = loggerFor(req, { route: 'earnings-tone' });

  // Codex round-3 P1: this route fans out to FMP (paid endpoint) AND
  // Anthropic, so an unbounded caller pays Wes twice per request. Durable
  // limit keeps the bucket consistent across Vercel instances. 20/min is
  // generous enough for a human refreshing the earnings panel while
  // catching automation that would burn $$$ at scale.
  const { key } = await getRateLimitIdentity(req);
  const { allowed } = await checkRateLimitDurable('earnings-tone', key, 20, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    // Codex round-3 P1 — zod-validate the query parameters before any of
    // them are interpolated into a URL, SQL filter, or Claude prompt.
    const queryParse = earningsToneQuerySchema.safeParse({
      symbol: req.nextUrl.searchParams.get('symbol') ?? '',
      quarter: req.nextUrl.searchParams.get('quarter') ?? String(getCurrentQuarter()),
      year: req.nextUrl.searchParams.get('year') ?? '2026',
    });
    if (!queryParse.success) {
      log.warn({ issues: queryParse.error.issues }, 'earnings-tone query validation failed');
      return NextResponse.json(
        { error: 'Invalid query parameters', issues: queryParse.error.issues },
        { status: 400 },
      );
    }
    const { symbol, quarter, year } = queryParse.data;

    // Check Supabase cache first
    try {
      const supabase = getSupabase();
      const { data: cached } = await (supabase.from as any)('earnings_tone')
        .select('*')
        .eq('symbol', symbol)
        .eq('quarter', quarter)
        .eq('year', year)
        .single();

      if (cached) {
        const c = cached as any;
        return NextResponse.json({
          symbol,
          quarter,
          year,
          hasTranscript: true,
          toneAnalysis: c.tone_analysis || {
            overallTone: c.overall_tone, confidence: c.confidence,
            guidanceTone: c.guidance_tone, defensiveness: c.defensiveness,
            languageShift: c.language_shift, redFlags: c.red_flags,
            bullishSignals: c.bullish_signals, keyQuotes: c.key_quotes,
            summary: c.summary, tradingImplication: c.trading_implication,
            conviction: c.conviction,
          },
          lastUpdated: c.created_at,
          cached: true,
        });
      }
    } catch (err) {
      // Cache miss or Supabase not configured — log and continue.
      log.debug({ err: err instanceof Error ? err.message : String(err) }, 'earnings-tone cache lookup failed');
    }

    // /stable/earning-call-transcript is a paid-tier endpoint on the current
    // plan; if the plan later upgrades this will work automatically. Until
    // then we degrade to "no transcript" instead of a hard error.
    const transcriptUrl = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&quarter=${quarter}&year=${year}&apikey=${FMP_KEY}`;
    const transcriptRes = await fetch(transcriptUrl);

    if (!transcriptRes.ok) {
      return NextResponse.json({
        symbol,
        quarter,
        year,
        hasTranscript: false,
        toneAnalysis: null,
        note: 'Transcript endpoint not available on current FMP plan tier',
        lastUpdated: new Date().toISOString(),
      });
    }

    const transcriptData = await transcriptRes.json();

    // FMP returns an array; check if we have content
    if (!transcriptData || !Array.isArray(transcriptData) || transcriptData.length === 0 || !transcriptData[0]?.content) {
      return NextResponse.json({
        symbol,
        quarter,
        year,
        hasTranscript: false,
        toneAnalysis: null,
        lastUpdated: new Date().toISOString(),
      });
    }

    const transcript = transcriptData[0].content;
    let toneAnalysis;

    // Try Claude analysis first
    try {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL_FALLBACK,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `You are an elite financial analyst specializing in earnings call tone analysis.
Analyze this transcript for ${symbol} Q${quarter} ${year}. Return ONLY valid JSON with these fields:
{
  "overallTone": number (1-10),
  "confidence": number (1-10),
  "guidanceTone": number (1-10),
  "defensiveness": number (1-10),
  "languageShift": "improving" | "stable" | "deteriorating",
  "redFlags": string[],
  "bullishSignals": string[],
  "keyQuotes": [{"quote": string, "significance": string}],
  "summary": string,
  "tradingImplication": "bullish" | "bearish" | "neutral",
  "conviction": number (1-10)
}

Transcript:
${transcript.slice(0, 80000)}`,
          },
        ],
      });
      tagAnthropicCall(message.usage, CLAUDE_MODEL_FALLBACK, { caller: 'earnings-tone' });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        toneAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in Claude response');
      }
    } catch (claudeError) {
      log.warn({ err: claudeError instanceof Error ? claudeError.message : String(claudeError) }, 'Claude tone analysis failed, falling back to keyword scan');
      toneAnalysis = fallbackKeywordAnalysis(transcript, symbol, quarter, year);
    }

    const lastUpdated = new Date().toISOString();

    // Try to cache in Supabase
    try {
      const supabase = getSupabase();
      await (supabase.from as any)('earnings_tone').upsert(
        {
          symbol,
          quarter,
          year,
          overall_tone: toneAnalysis.overallTone,
          confidence: toneAnalysis.confidence,
          guidance_tone: toneAnalysis.guidanceTone,
          defensiveness: toneAnalysis.defensiveness,
          language_shift: toneAnalysis.languageShift,
          red_flags: toneAnalysis.redFlags,
          bullish_signals: toneAnalysis.bullishSignals,
          key_quotes: toneAnalysis.keyQuotes,
          trading_implication: toneAnalysis.tradingImplication,
          conviction: toneAnalysis.conviction,
          summary: toneAnalysis.summary,
        },
        { onConflict: 'symbol,quarter,year' }
      );
    } catch (err) {
      // Caching failure is non-critical
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to cache earnings tone in Supabase');
    }

    return NextResponse.json({
      symbol,
      quarter,
      year,
      hasTranscript: true,
      toneAnalysis,
      lastUpdated,
    });
  } catch (error) {
    log.error({ err: error instanceof Error ? error.message : String(error) }, 'Earnings tone API error');
    return NextResponse.json(
      { error: 'Failed to analyze earnings tone' },
      { status: 500 }
    );
  }
}
