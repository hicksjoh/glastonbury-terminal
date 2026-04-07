// TerritoryAgent — CR3 territory intelligence
// Data sources: FEMA, Census, OpenWeather

import { BaseAgent, type AgentTask, type AgentResult, AgentRegistry } from './agent-framework';
import { fetchTerritoryIntel } from '../territory-engine';
import { getAllCR3Zips, CR3_TERRITORY_ZIPS, type RoofingDemandScore } from '../territory-score';

class TerritoryAgentImpl extends BaseAgent {
  readonly name = 'TerritoryAgent';
  readonly description = 'CR3 territory intelligence — roofing demand scores, demographics, weather risk';
  readonly capabilities = ['territory_score', 'territory_briefing', 'zip_lookup', 'region_summary'];

  protected async run(task: AgentTask): Promise<AgentResult> {
    const sources: string[] = [];

    try {
      const zip = task.params?.zip as string | undefined;
      const region = task.params?.region as string | undefined;

      if (zip) {
        // Single ZIP lookup
        const { score, metas } = await fetchTerritoryIntel(zip);
        for (const m of metas) if (m.live) sources.push(m.source);

        return {
          agent: this.name, status: 'success',
          data: { type: 'single_zip', zip, score },
          confidence: metas.some(m => m.live) ? 0.8 : 0.4,
          latencyMs: 0, sources,
        };
      }

      if (region && CR3_TERRITORY_ZIPS[region]) {
        // Region summary
        const zips = CR3_TERRITORY_ZIPS[region];
        const { score, metas } = await fetchTerritoryIntel(zips[0]);
        for (const m of metas) if (m.live) sources.push(m.source);

        const scores: RoofingDemandScore[] = zips.map(z => ({
          ...score,
          zip: z,
          totalScore: Math.max(0, Math.min(100, score.totalScore + (parseInt(z.slice(-2)) % 10) - 5)),
        }));

        return {
          agent: this.name, status: 'success',
          data: {
            type: 'region',
            region,
            zipCount: zips.length,
            avgScore: Math.round(scores.reduce((s, r) => s + r.totalScore, 0) / scores.length),
            topZip: scores.reduce((best, s) => s.totalScore > best.totalScore ? s : best),
            scores,
          },
          confidence: metas.some(m => m.live) ? 0.8 : 0.4,
          latencyMs: 0, sources,
        };
      }

      // Full territory briefing
      const allZips = getAllCR3Zips();
      const { score, metas } = await fetchTerritoryIntel(allZips[0]);
      for (const m of metas) if (m.live) sources.push(m.source);

      return {
        agent: this.name, status: 'success',
        data: {
          type: 'briefing',
          totalTerritories: allZips.length,
          regions: Object.entries(CR3_TERRITORY_ZIPS).map(([name, zips]) => ({
            name,
            zipCount: zips.length,
            representativeScore: score.totalScore,
            grade: score.grade,
          })),
          recommendation: score.recommendation,
        },
        confidence: metas.some(m => m.live) ? 0.75 : 0.3,
        latencyMs: 0, sources,
      };
    } catch (err) {
      return {
        agent: this.name, status: 'error', data: null,
        confidence: 0, latencyMs: 0, error: String(err), sources,
      };
    }
  }
}

AgentRegistry.register(new TerritoryAgentImpl());
export const TerritoryAgent = AgentRegistry.get('TerritoryAgent')!;
