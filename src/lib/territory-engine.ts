// Territory Intelligence Engine
// Aggregates data from: FEMA, Census (free), OpenWeather, and computes Roofing Demand Scores
// APIs requiring paid keys (ATTOM, etc.) gracefully fall back

import { apiFetchWithFallback, type ApiResult } from './api-client';
import { buildMeta, type ApiMeta } from './api-meta';
import {
  type TerritoryData,
  type RoofingDemandScore,
  calculateRoofingDemandScore,
} from './territory-score';

// ---------------------------------------------------------------------------
// FEMA Disaster Declarations (FREE — no API key)
// ---------------------------------------------------------------------------

interface FemaDeclaration {
  disasterNumber: number;
  declarationTitle: string;
  declarationType: string;
  declarationDate: string;
  incidentType: string;
  state: string;
  designatedArea: string;
  [k: string]: unknown;
}

interface FemaResponse {
  DisasterDeclarationsSummaries?: FemaDeclaration[];
}

export async function fetchFemaDisasters(state: string): Promise<ApiResult<FemaDeclaration[]>> {
  const tenYearsAgo = new Date(Date.now() - 10 * 365 * 86400000).toISOString().split('T')[0];
  // FEMA API is free, no key needed. Use direct fetch with cache.
  try {
    const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state eq '${state}' and declarationDate ge '${tenYearsAgo}'&$top=200`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`FEMA HTTP ${res.status}`);
    const data = await res.json() as FemaResponse;
    const declarations = data.DisasterDeclarationsSummaries ?? [];
    return {
      data: declarations,
      _meta: buildMeta({ source: 'fema', live: true }),
    };
  } catch (err) {
    return {
      data: [],
      _meta: buildMeta({ source: 'fema', live: false, error: String(err) }),
    };
  }
}

// ---------------------------------------------------------------------------
// Census Bureau Demographics (FREE — works without key)
// ---------------------------------------------------------------------------

interface CensusResult {
  population: number;
  medianIncome: number;
  medianAge: number;
  homeownershipRate: number;
  totalHousingUnits: number;
}

export async function fetchCensusData(state: string, county?: string): Promise<ApiResult<CensusResult | null>> {
  try {
    // ACS 5-year estimates — free, no key required for basic queries
    const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : '';
    const geo = county
      ? `for=county:${county}&in=state:${state}`
      : `for=state:${state}`;

    const url = `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B01002_001E,B25003_002E,B25001_001E&${geo}${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Census HTTP ${res.status}`);
    const data = await res.json();

    // Census returns array of arrays: [headers, ...data]
    if (!Array.isArray(data) || data.length < 2) return { data: null, _meta: buildMeta({ source: 'census', live: false, error: 'No data' }) };

    const row = data[1];
    const totalHousing = Number(row[4]) || 1;

    return {
      data: {
        population: Number(row[0]) || 0,
        medianIncome: Number(row[1]) || 0,
        medianAge: Number(row[2]) || 0,
        homeownershipRate: (Number(row[3]) / totalHousing) * 100,
        totalHousingUnits: totalHousing,
      },
      _meta: buildMeta({ source: 'census', live: true }),
    };
  } catch (err) {
    return { data: null, _meta: buildMeta({ source: 'census', live: false, error: String(err) }) };
  }
}

// ---------------------------------------------------------------------------
// OpenWeatherMap (requires OPENWEATHER_API_KEY)
// ---------------------------------------------------------------------------

interface WeatherResult {
  avgAnnualPrecipitation: number;
  avgWindSpeed: number;
  hailRiskScore: number;
  hurricaneRiskScore: number;
  freezeThawCycles: number;
  currentTemp: number;
  currentCondition: string;
}

export async function fetchWeatherData(lat: number, lon: number): Promise<ApiResult<WeatherResult | null>> {
  if (!process.env.OPENWEATHER_API_KEY) {
    return { data: null, _meta: buildMeta({ source: 'openweather', live: false, error: 'No API key' }) };
  }

  const result = await apiFetchWithFallback<{
    main?: { temp?: number };
    wind?: { speed?: number };
    weather?: { main?: string; description?: string }[];
  }>(
    'openweather', '/weather',
    { lat: String(lat), lon: String(lon), units: 'imperial' },
    {},
    { cacheTtlMs: 30 * 60 * 1000 }, // 30min cache
  );

  if (!result.data.main) {
    return { data: null, _meta: result._meta };
  }

  // South Florida weather risk profile — hurricane zone
  const isFlCoast = lat > 25 && lat < 28 && lon > -83 && lon < -79;

  return {
    data: {
      avgAnnualPrecipitation: isFlCoast ? 62 : 50,  // FL avg
      avgWindSpeed: result.data.wind?.speed ?? 10,
      hailRiskScore: isFlCoast ? 3 : 5,             // FL lower hail than Midwest
      hurricaneRiskScore: isFlCoast ? 8 : 4,         // FL coast high hurricane risk
      freezeThawCycles: isFlCoast ? 2 : 30,          // FL minimal freeze-thaw
      currentTemp: result.data.main.temp ?? 0,
      currentCondition: result.data.weather?.[0]?.description ?? 'unknown',
    },
    _meta: result._meta,
  };
}

// ---------------------------------------------------------------------------
// Territory composite — fetch all data for a ZIP and score it
// ---------------------------------------------------------------------------

// ZIP → approximate lat/lon (Florida ZIPs)
const ZIP_COORDS: Record<string, [number, number]> = {
  '33401': [26.7153, -80.0534], '33460': [26.6851, -80.0728],
  '33480': [26.7056, -80.0364], '33404': [26.7450, -80.0583],
  '33407': [26.7512, -80.0831], '33062': [26.3186, -80.0776],
  '33060': [26.2545, -80.1006], '33064': [26.2805, -80.1281],
  '33071': [26.2515, -80.2245], '34990': [27.1006, -80.1619],
  '34994': [27.1975, -80.2528], '34996': [27.2086, -80.2236],
  '34997': [27.2359, -80.2875], '33901': [26.6223, -81.8485],
  '33903': [26.6866, -81.9044], '33907': [26.5802, -81.8670],
  '33908': [26.5266, -81.8996], '33912': [26.5471, -81.8240],
  '34102': [26.1350, -81.7979], '34103': [26.1762, -81.8048],
  '34108': [26.2530, -81.8071], '34109': [26.2266, -81.7768],
  '34110': [26.2712, -81.7543],
};

// FL state FIPS for Census
const FL_FIPS = '12';

export async function fetchTerritoryIntel(zip: string): Promise<{
  territoryData: TerritoryData;
  score: RoofingDemandScore;
  metas: ApiMeta[];
}> {
  const coords = ZIP_COORDS[zip] ?? [26.7, -80.1]; // Default to Palm Beach
  const metas: ApiMeta[] = [];

  // Fetch all data sources in parallel
  const [femaResult, censusResult, weatherResult] = await Promise.all([
    fetchFemaDisasters('FL'),
    fetchCensusData(FL_FIPS),
    fetchWeatherData(coords[0], coords[1]),
  ]);

  metas.push(femaResult._meta, censusResult._meta);
  if (weatherResult._meta) metas.push(weatherResult._meta);

  // Build territory data
  const territoryData: TerritoryData = { zip };

  // FEMA disasters
  if (femaResult.data.length > 0) {
    const stormTypes = ['Severe Storm', 'Hurricane', 'Tornado', 'Flood'];
    const stormDeclarations = femaResult.data.filter(d =>
      stormTypes.some(t => d.incidentType?.includes(t) || d.declarationTitle?.includes(t))
    );

    territoryData.disasters = {
      totalDeclarations: femaResult.data.length,
      stormDeclarations: stormDeclarations.length,
      recentDisasters: femaResult.data.slice(0, 5).map(d => ({
        type: d.incidentType || 'Unknown',
        date: d.declarationDate || '',
        title: d.declarationTitle || '',
      })),
    };
  }

  // Census
  if (censusResult.data) {
    territoryData.demographics = {
      population: censusResult.data.population,
      medianIncome: censusResult.data.medianIncome,
      medianAge: censusResult.data.medianAge,
      homeownershipRate: censusResult.data.homeownershipRate,
    };

    // Estimate property data from census (ATTOM would be better but requires paid key)
    territoryData.propertyData = {
      medianHomeValue: Math.round(censusResult.data.medianIncome * 4.5), // rough proxy
      totalProperties: censusResult.data.totalHousingUnits,
      avgHomeAge: 22, // FL average
      ownerOccupiedPct: censusResult.data.homeownershipRate,
    };
  }

  // Weather
  if (weatherResult.data) {
    territoryData.weather = weatherResult.data;
  }

  // Calculate score
  const score = calculateRoofingDemandScore(territoryData);

  return { territoryData, score, metas };
}
