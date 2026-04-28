import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getQuote } from '@/lib/fmp-client';

async function fetchVIX(): Promise<number | null> {
  const q = await getQuote('^VIX');
  return q?.price ?? null;
}

async function fetchSPYMomentum(): Promise<number | null> {
  const q = await getQuote('SPY');
  return q?.changePercentage ?? null;
}

function detectRegime(vix: number | null, momentum: number | null): { regime: string; confidence: number } {
  const v = vix ?? 20;
  const m = momentum ?? 0;

  if (v < 20 && m > 0) return { regime: 'bull_low_vol', confidence: 0.75 + Math.min(0.2, (20 - v) / 100) };
  if (v >= 20 && m > 0) return { regime: 'bull_high_vol', confidence: 0.6 };
  if (v < 20 && m <= 0) return { regime: 'bear_low_vol', confidence: 0.55 };
  return { regime: 'bear_high_vol', confidence: 0.7 + Math.min(0.2, (v - 30) / 100) };
}

export async function GET() {
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
    const { regime, confidence } = detectRegime(vix, momentum);

    // Store new regime
    await supabase.from('market_regime').insert({
      regime,
      confidence,
      vix,
      momentum_factor: momentum,
    });

    return NextResponse.json({
      success: true,
      data: { regime, confidence, vix, momentum_factor: momentum, detected_at: new Date().toISOString(), stale: false },
    });
  } catch (error) {
    console.error('Regime API error:', error);
    return NextResponse.json({
      success: true,
      data: { regime: 'bull_low_vol', confidence: 0.5, vix: null, momentum_factor: null, detected_at: null, stale: true },
    });
  }
}
