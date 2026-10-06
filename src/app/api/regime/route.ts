import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getQuote } from '@/lib/fmp-client';
import { withRateLimit, RATE } from '@/lib/api-rate-limit';
import { classifyRegime } from '@/lib/market-regime';

// Live-data endpoint — never let Next static-optimize this at build time
export const dynamic = 'force-dynamic';

async function fetchVIX(): Promise<number | null> {
  const q = await getQuote('^VIX');
  return q?.price ?? null;
}

async function fetchSPYMomentum(): Promise<number | null> {
  const q = await getQuote('SPY');
  return q?.changePercentage ?? null;
}

async function GET_impl() {
  try {
    const supabase = createServiceClient();

    // Check for recent regime detection (< 1 hour old)
    const { data: recent } = await supabase
      .from('market_regime')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(1);

    const lastRegime = recent?.[0];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStale = !lastRegime || new Date(lastRegime.detected_at) < oneHourAgo;

    if (!isStale && lastRegime) {
      return NextResponse.json({
        success: true,
        data: {
          regime: lastRegime.regime,
          confidence: lastRegime.confidence,
          vix: lastRegime.vix,
          momentum_factor: lastRegime.momentum_factor,
          detected_at: lastRegime.detected_at,
          stale: false,
        },
      });
    }

    // Fetch fresh data
    const [vix, momentum] = await Promise.all([fetchVIX(), fetchSPYMomentum()]);
    const { regime, confidence } = classifyRegime(vix, momentum);

    // An unclassifiable read is reported, never stored: a cached 'unknown'
    // would mask the next hour of good data.
    if (regime === 'unknown') {
      return NextResponse.json({
        success: false,
        data: { regime, confidence, vix, momentum_factor: momentum, detected_at: null, stale: true },
      });
    }

    const { error: insertError } = await supabase.from('market_regime').insert({
      regime,
      confidence,
      vix,
      momentum_factor: momentum,
    });
    if (insertError) console.error('market_regime insert failed:', insertError.message);

    return NextResponse.json({
      success: true,
      data: { regime, confidence, vix, momentum_factor: momentum, detected_at: new Date().toISOString(), stale: false },
    });
  } catch (error) {
    console.error('Regime API error:', error);
    return NextResponse.json({
      success: false,
      data: { regime: 'unknown', confidence: 0, vix: null, momentum_factor: null, detected_at: null, stale: true },
    });
  }
}

// Durable, session-keyed rate limiting (CLAUDE.md rule 6). See
// src/lib/api-rate-limit.ts — the old in-memory limiter was per-lambda.
export const GET = withRateLimit('regime', RATE.UPSTREAM, GET_impl);
