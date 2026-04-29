// Shared preferences-block builder for Keisha routes.
//
// The risk/comm/explanation/paper settings come from the client and need to
// land in the dynamic system context for both /api/keisha and
// /api/keisha/stream. Living in one place keeps the two routes from drifting.

export interface KeishaSettings {
  riskTolerance?: number;
  commStyle?: string;
  paperMode?: boolean;
  explanationLevel?: string;
}

function getRiskLabel(value: number): string {
  if (value <= 33) return 'Conservative';
  if (value <= 66) return 'Moderate';
  return 'Aggressive';
}

function getRiskDescription(value: number): string {
  if (value <= 33) return 'prioritize capital preservation, smaller positions, wide stops';
  if (value <= 66) return 'balanced risk/reward, standard position sizing';
  return 'willing to take bigger positions, tighter stops, higher conviction plays';
}

function getCommStyleInstruction(style: string): string {
  if (style === 'brief') return 'Keep responses concise (under 150 words). Skip preambles. Lead with the answer.';
  return 'Give thorough analysis with supporting data, scenarios, and reasoning.';
}

function getExplanationInstruction(level?: string): string {
  switch (level) {
    case 'technical':
      return 'Respond with full technical detail. Use precise trading terminology, Greek letter names, quant metrics. Assume the user is an expert trader.';
    case 'plain_talk':
      return 'Explain everything in plain, everyday English. No jargon. Use analogies and real-world comparisons. Example: Instead of "theta decay is accelerating", say "your option is losing value faster each day — like ice cream melting quicker as the day gets hotter." Keep sentences short and conversational.';
    default:
      return 'Use proper trading terminology but include brief parenthetical explanations for technical terms. Example: "GEX flipped negative (market makers are no longer cushioning price moves, so expect bigger swings)".';
  }
}

export function buildPreferencesBlock(settings?: KeishaSettings): string {
  const risk = settings?.riskTolerance ?? 50;
  const style = settings?.commStyle ?? 'detailed';
  const paper = settings?.paperMode ?? true;
  const explainLevel = settings?.explanationLevel ?? 'balanced';

  const riskLabel = getRiskLabel(risk);
  const riskDesc = getRiskDescription(risk);
  const commInstruction = getCommStyleInstruction(style);
  const modeLabel = paper ? 'paper' : 'live';
  const modeWarning = paper ? '' : ' — LIVE TRADING ENABLED. Double-confirm all orders with Wes before execution.';
  const explanationInstruction = getExplanationInstruction(explainLevel);

  return `
USER PREFERENCES:
- Risk Tolerance: ${riskLabel} (${risk}/100) — ${riskDesc}
- Communication Style: ${style} — ${commInstruction}
- Explanation Level: ${explainLevel} — ${explanationInstruction}
- Trading Mode: ${modeLabel}${modeWarning}`;
}
