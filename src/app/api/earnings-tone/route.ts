import { NextRequest, NextResponse } from 'next/server';
import { anthropic, CLAUDE_MODEL_FALLBACK } from '@/lib/claude';
import { getSupabase } from '@/lib/supabase';

const FMP_KEY = process.env.FMP_API_KEY;

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
  try {
    if (!FMP_KEY) {
      return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
    }

    const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: 'symbol parameter is required' }, { status: 400 });
    }

    const quarter = parseInt(req.nextUrl.searchParams.get('quarter') || String(getCurrentQuarter()), 10);
    const year = parseInt(req.nextUrl.searchParams.get('year') || '2026', 10);

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
    } catch {
      // Cache miss or Supabase not configured — continue
    }

    // Fetch transcript from FMP
    const transcriptUrl = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${symbol}?quarter=${quarter}&year=${year}&apikey=${FMP_KEY}`;
    const transcriptRes = await fetch(transcriptUrl);

    if (!transcriptRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch transcript from FMP' }, { status: 502 });
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

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        toneAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in Claude response');
      }
    } catch (claudeError) {
      console.error('Claude analysis failed, falling back to keyword scan:', claudeError);
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
    } catch {
      // Caching failure is non-critical
      console.warn('Failed to cache earnings tone in Supabase');
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
    console.error('Earnings tone API error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze earnings tone' },
      { status: 500 }
    );
  }
}
