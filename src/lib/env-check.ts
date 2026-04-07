// Environment variable validation
// Call at startup to catch missing keys early

interface EnvVar {
  name: string;
  required: boolean;
  phase: number;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  // Existing (Phase 0)
  { name: 'ALPACA_API_KEY', required: true, phase: 0, description: 'Alpaca trading API key' },
  { name: 'ALPACA_SECRET_KEY', required: true, phase: 0, description: 'Alpaca trading secret' },
  { name: 'ANTHROPIC_API_KEY', required: true, phase: 0, description: 'Claude AI API key' },
  { name: 'FMP_API_KEY', required: true, phase: 0, description: 'Financial Modeling Prep API key' },
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, phase: 0, description: 'Supabase project URL' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, phase: 0, description: 'Supabase anonymous key' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: false, phase: 0, description: 'Supabase service role key' },

  // Phase 1
  { name: 'FINNHUB_API_KEY', required: false, phase: 1, description: 'Finnhub real-time quotes/news' },
  { name: 'FRED_API_KEY', required: false, phase: 1, description: 'Federal Reserve economic data' },
  { name: 'POLYGON_API_KEY', required: false, phase: 1, description: 'Polygon.io options/bars data' },
  { name: 'QUIVER_API_KEY', required: false, phase: 1, description: 'Quiver Quant congress trades' },

  // Phase 2
  { name: 'UNUSUAL_WHALES_API_KEY', required: false, phase: 2, description: 'Unusual Whales flow data' },
  { name: 'NASDAQ_DATA_LINK_API_KEY', required: false, phase: 2, description: 'Nasdaq short interest/FTD' },
  { name: 'ATTOM_API_KEY', required: false, phase: 2, description: 'ATTOM property data' },
  { name: 'CENSUS_API_KEY', required: false, phase: 2, description: 'Census Bureau demographics' },
  { name: 'OPENWEATHER_API_KEY', required: false, phase: 2, description: 'OpenWeatherMap weather data' },
  { name: 'NEWSAPI_KEY', required: false, phase: 2, description: 'NewsAPI headlines' },
  { name: 'GNEWS_API_KEY', required: false, phase: 2, description: 'GNews global news' },
];

export interface EnvCheckResult {
  valid: boolean;
  missing: { name: string; required: boolean; phase: number; description: string }[];
  present: { name: string; phase: number }[];
  warnings: string[];
}

export function checkEnvironment(): EnvCheckResult {
  const missing: EnvCheckResult['missing'] = [];
  const present: EnvCheckResult['present'] = [];
  const warnings: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.name];
    if (!value || value.trim() === '') {
      missing.push({
        name: envVar.name,
        required: envVar.required,
        phase: envVar.phase,
        description: envVar.description,
      });
      if (envVar.required) {
        warnings.push(`REQUIRED: ${envVar.name} is not set — ${envVar.description}`);
      }
    } else {
      present.push({ name: envVar.name, phase: envVar.phase });
    }
  }

  // Check for common mistakes
  const alpacaKey = process.env.ALPACA_API_KEY ?? '';
  if (alpacaKey && alpacaKey.startsWith('CK')) {
    warnings.push('ALPACA_API_KEY looks like a live key (starts with CK) — ensure ALPACA_PAPER=true for paper trading');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (supabaseUrl && !supabaseUrl.startsWith('https://')) {
    warnings.push('NEXT_PUBLIC_SUPABASE_URL should start with https://');
  }

  return {
    valid: missing.filter(m => m.required).length === 0,
    missing,
    present,
    warnings,
  };
}

export function getEnvStatus(): Record<string, { set: boolean; phase: number }> {
  const status: Record<string, { set: boolean; phase: number }> = {};
  for (const envVar of ENV_VARS) {
    status[envVar.name] = {
      set: !!(process.env[envVar.name]?.trim()),
      phase: envVar.phase,
    };
  }
  return status;
}
