import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const DEFAULT_WEIGHTS: Record<string, number> = {
  insider: 25,
  flow: 20,
  sentiment: 15,
  earnings: 10,
  technical: 10,
  pairs: 0,
  drift: 0,
};

export async function GET() {
  try {
    const supabase = createServiceClient();
    const sources = Object.keys(DEFAULT_WEIGHTS);

    // Fetch all signals that have been acted on with outcomes
    let signals: any[] = [];
    try {
      const { data } = await (supabase as any).from('scanner_signals')
        .select('*')
        .eq('acted_on', true)
        .not('outcome', 'is', null);
      signals = data || [];
    } catch {
      // Table may not exist — use empty
    }

    const calibration = sources.map(source => {
      const relevant = signals.filter((s: any) =>
        Array.isArray(s.sources) && s.sources.some((src: string) => src.includes(source))
      );
      const wins = relevant.filter((s: any) => s.outcome === 'win');
      const precision = relevant.length > 0 ? wins.length / relevant.length : 0;
      const avgReturn = relevant.length > 0
        ? relevant.reduce((sum: number, s: any) => sum + (s.return_pct || 0), 0) / relevant.length
        : 0;

      // Bayesian-style weight update
      const sampleWeight = Math.min(relevant.length / 20, 1);
      const observedWeight = precision * 100;
      const recommendedWeight = Math.round(
        DEFAULT_WEIGHTS[source] * (1 - sampleWeight) + observedWeight * sampleWeight
      );

      return {
        source,
        defaultWeight: DEFAULT_WEIGHTS[source],
        actualPrecision: Math.round(precision * 100),
        actualAvgReturn: Math.round(avgReturn * 100) / 100,
        recommendedWeight,
        sampleSize: relevant.length,
      };
    });

    // Store calibration results
    for (const cal of calibration) {
      try {
        await (supabase as any).from('signal_calibration').upsert({
          source: cal.source,
          default_weight: cal.defaultWeight,
          actual_precision: cal.actualPrecision,
          actual_avg_return: cal.actualAvgReturn,
          recommended_weight: cal.recommendedWeight,
          sample_size: cal.sampleSize,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source' });
      } catch {
        // Non-critical — continue
      }
    }

    const topPerformer = calibration.reduce((a, b) => a.actualPrecision > b.actualPrecision ? a : b);
    const withData = calibration.filter(c => c.sampleSize > 3);
    const worstPerformer = withData.length > 0
      ? withData.reduce((a, b) => a.actualPrecision < b.actualPrecision ? a : b)
      : calibration[0];

    const totalWeightedPrecision = calibration.reduce((sum, c) => sum + c.actualPrecision * c.sampleSize, 0);
    const totalSamples = calibration.reduce((sum, c) => sum + c.sampleSize, 0);

    return NextResponse.json({
      calibration,
      topPerformer: topPerformer.source,
      worstPerformer: worstPerformer?.source,
      overallAccuracy: Math.round(totalWeightedPrecision / Math.max(totalSamples, 1)),
      recommendation: `Top signal: ${topPerformer.source} (${topPerformer.actualPrecision}% precision). ` +
        `Consider ${worstPerformer?.actualPrecision < 40 ? 'reducing' : 'maintaining'} ${worstPerformer?.source} weight.`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/keisha/calibrate] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
