import { z, type ZodType } from 'zod';

const apiMetaSchema = z.object({
  source: z.string(),
  live: z.boolean(),
  cached: z.boolean().optional(),
  stale: z.boolean().optional(),
  error: z.string().optional(),
}).passthrough();

const earningsEntrySchema = z.object({
  symbol: z.string(),
  company: z.string(),
  date: z.string(),
  time: z.string(),
  epsEstimate: z.number().nullable(),
  revenueEstimate: z.number().nullable(),
  surpriseHistory: z.object({
    beatRate: z.number().nullable(),
    avgSurprise: z.number().nullable(),
    avgMoveOnEarnings: z.number().nullable(),
  }).nullable().optional(),
  ivAnalysis: z.object({
    currentIV: z.number().nullable(),
    avgPostEarningsIV: z.number().nullable(),
    crushEstimate: z.number().nullable(),
    straddle_price: z.number().nullable(),
  }).nullable().optional(),
  playRecommendation: z.string(),
}).passthrough();

export const earningsResponseSchema = z.object({
  upcoming: z.array(earningsEntrySchema),
  thisWeek: z.number(),
  highImpact: z.array(earningsEntrySchema),
  _meta: apiMetaSchema.optional(),
}).passthrough();

const skewAnalysisSchema = z.object({
  expiration: z.string().optional(),
  skewType: z.string(),
  putSkew25d: z.number(),
  callSkew25d: z.number(),
  riskReversal: z.number(),
  butterfly: z.number(),
  skewSlope: z.number(),
  interpretation: z.string(),
}).passthrough();

export const volSurfaceResponseSchema = z.object({
  symbol: z.string(),
  spotPrice: z.number(),
  surface: z.object({
    grid: z.array(z.object({
      strike: z.number(),
      expiry: z.string(),
      iv: z.number(),
      delta: z.number().optional(),
    }).passthrough()),
    strikes: z.array(z.number()),
    expirations: z.array(z.string()),
  }).passthrough(),
  skewAnalysis: z.union([z.array(skewAnalysisSchema), skewAnalysisSchema]).nullable(),
  termStructure: z.object({
    points: z.array(z.object({ expiry: z.string(), iv: z.number() }).passthrough()),
    shape: z.string(),
  }).passthrough(),
  mispricings: z.array(z.object({
    strike: z.number(), expiry: z.string(), type: z.string(),
    currentIV: z.number(), expectedIV: z.number(), edge: z.number(), direction: z.string(),
  }).passthrough()),
  lastUpdated: z.string(),
}).passthrough();

export const alertsResponseSchema = z.object({
  alerts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    conditions: z.array(z.object({
      symbol: z.string(), metric: z.string(), operator: z.string(), value: z.number(),
    }).passthrough()),
    logic: z.string(),
    action: z.string(),
    is_active: z.boolean(),
    last_triggered: z.string().nullable(),
    created_at: z.string(),
  }).passthrough()),
}).passthrough();

export const flowResponseSchema = z.object({
  flows: z.array(z.object({
    underlying: z.string(),
    contract: z.string(),
    type: z.enum(['call', 'put']),
    strike: z.number(),
    expiration: z.string(),
    volume: z.number(),
    openInterest: z.number(),
    volOiRatio: z.number(),
    premiumUSD: z.number(),
    impliedVolatility: z.number().nullable(),
    delta: z.number().nullable(),
    direction: z.enum(['bullish', 'bearish']),
    flowType: z.enum(['sweep', 'block', 'unusual']),
  }).passthrough()),
  summary: z.object({
    totalFlows: z.number(), bullishPct: z.number(), bearishPct: z.number(),
    topSymbols: z.array(z.string()), scannedSymbols: z.array(z.string()).optional(),
  }).passthrough(),
  _meta: apiMetaSchema.optional(),
}).passthrough();

export const gexResponseSchema = z.object({
  symbol: z.string(),
  spotPrice: z.number(),
  netGEX: z.number(),
  regime: z.string(),
  levels: z.object({
    putWall: z.number(), callWall: z.number(), hvl: z.number(), gammaFlip: z.number(),
    gammaFlipPrecise: z.number().nullable(), pinStrikes: z.array(z.number()),
  }).passthrough(),
  vannaExposure: z.number(),
  charmExposure: z.number(),
  impact: z.string(),
  byStrike: z.array(z.object({ strike: z.number(), gex: z.number() }).passthrough()),
  expirationBreakdown: z.array(z.object({ expiration: z.string(), gex: z.number() }).passthrough()),
  dataSource: z.string(),
  lastUpdated: z.string(),
  _meta: apiMetaSchema.optional(),
}).passthrough();

export const macroResponseSchema = z.object({
  regime: z.object({
    regime: z.string(), confidence: z.number(), score: z.number(),
    factorBreakdown: z.record(z.string(), z.object({ score: z.number(), signal: z.string() })),
  }),
  indicators: z.object({
    yield10Y: z.number(), yield2Y: z.number(), yieldCurveSlope: z.number(),
    fedFunds: z.number(), vix: z.number(), dxy: z.number(),
    creditSpread: z.number(), unemploymentRate: z.number(),
    cpi: z.number(), gdpGrowth: z.number(),
  }),
  fedPrediction: z.object({
    prediction: z.enum(['hike', 'hold', 'cut']), confidence: z.number(), impliedRate: z.number(),
  }),
  allocation: z.object({
    equities: z.number(), bonds: z.number(), commodities: z.number(), cash: z.number(), alternatives: z.number(),
  }),
  upcomingEvents: z.array(z.object({ date: z.string(), event: z.string(), importance: z.string() })),
  interpretation: z.string(),
  lastUpdated: z.string(),
  _meta: apiMetaSchema.optional(),
}).passthrough();

export const scannerResponseSchema = z.object({
  signals: z.array(z.object({
    symbol: z.string(), company: z.string(), score: z.number(), sources: z.array(z.string()),
    kellySizing: z.object({ shares: z.number(), dollars: z.number(), pctOfPortfolio: z.number() }).nullable(),
    thesis: z.string(), regime_fit: z.boolean(),
  }).passthrough()),
  preset: z.string(),
  timestamp: z.string(),
  marketRegime: z.string(),
  _meta: apiMetaSchema.optional(),
}).passthrough();

export async function fetchParsed<T>(
  url: string,
  schema: ZodType<T>,
  opts?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(url, opts);
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn(`API response validation failed for ${url}`, parsed.error.issues);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
