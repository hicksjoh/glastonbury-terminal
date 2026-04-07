// Roofing Demand Score (0-100) per ZIP code
// Combines: property data, demographics, weather risk, disaster history, business climate
// Used by CR3 American Exteriors territory intelligence

export interface TerritoryData {
  zip: string;
  propertyData?: {
    medianHomeValue: number;
    totalProperties: number;
    avgHomeAge: number;      // years
    ownerOccupiedPct: number;
  };
  demographics?: {
    population: number;
    medianIncome: number;
    medianAge: number;
    homeownershipRate: number;
  };
  weather?: {
    avgAnnualPrecipitation: number; // inches
    avgWindSpeed: number;           // mph
    hailRiskScore: number;          // 0-10
    hurricaneRiskScore: number;     // 0-10
    freezeThawCycles: number;       // annual count
  };
  disasters?: {
    totalDeclarations: number;      // FEMA declarations in last 10 years
    stormDeclarations: number;
    recentDisasters: { type: string; date: string; title: string }[];
  };
  businessClimate?: {
    sbaLoansCount: number;
    avgLoanSize: number;
    businessGrowthRate: number;     // percentage
  };
}

export interface RoofingDemandScore {
  zip: string;
  totalScore: number;               // 0-100
  breakdown: {
    propertyScore: number;           // 0-25 — home value + age + count
    demographicScore: number;        // 0-20 — income + homeownership
    weatherRiskScore: number;        // 0-30 — storm/hail/hurricane exposure
    disasterScore: number;           // 0-15 — FEMA declarations
    businessScore: number;           // 0-10 — SBA activity
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  recommendation: string;
  dataSources: string[];
}

export function calculateRoofingDemandScore(data: TerritoryData): RoofingDemandScore {
  const sources: string[] = [];
  let propertyScore = 0;
  let demographicScore = 0;
  let weatherRiskScore = 0;
  let disasterScore = 0;
  let businessScore = 0;

  // Property Score (0-25)
  if (data.propertyData) {
    sources.push('property');
    const { medianHomeValue, totalProperties, avgHomeAge, ownerOccupiedPct } = data.propertyData;

    // Higher home values = more expensive roofs = more revenue per job
    if (medianHomeValue > 500000) propertyScore += 8;
    else if (medianHomeValue > 300000) propertyScore += 6;
    else if (medianHomeValue > 200000) propertyScore += 4;
    else propertyScore += 2;

    // More properties = larger addressable market
    if (totalProperties > 50000) propertyScore += 5;
    else if (totalProperties > 20000) propertyScore += 4;
    else if (totalProperties > 10000) propertyScore += 3;
    else propertyScore += 1;

    // Older homes need roof replacement more often (15-25 year cycle)
    if (avgHomeAge > 20) propertyScore += 7;
    else if (avgHomeAge > 15) propertyScore += 5;
    else if (avgHomeAge > 10) propertyScore += 3;
    else propertyScore += 1;

    // Owner-occupied more likely to invest in roofing
    propertyScore += Math.min(5, Math.round(ownerOccupiedPct / 20));
  }

  // Demographic Score (0-20)
  if (data.demographics) {
    sources.push('census');
    const { medianIncome, homeownershipRate, population } = data.demographics;

    // Higher income = can afford roofing
    if (medianIncome > 100000) demographicScore += 8;
    else if (medianIncome > 75000) demographicScore += 6;
    else if (medianIncome > 50000) demographicScore += 4;
    else demographicScore += 2;

    // Higher homeownership = more potential customers
    demographicScore += Math.min(7, Math.round(homeownershipRate / 10));

    // Population density matters
    if (population > 100000) demographicScore += 5;
    else if (population > 50000) demographicScore += 4;
    else if (population > 20000) demographicScore += 3;
    else demographicScore += 1;
  }

  // Weather Risk Score (0-30) — storms create roofing demand
  if (data.weather) {
    sources.push('weather');
    const { hailRiskScore, hurricaneRiskScore, avgWindSpeed, freezeThawCycles } = data.weather;

    // Hail is the #1 driver of insurance roofing claims
    weatherRiskScore += Math.min(12, hailRiskScore * 1.2);

    // Hurricane exposure
    weatherRiskScore += Math.min(8, hurricaneRiskScore * 0.8);

    // High wind areas
    if (avgWindSpeed > 15) weatherRiskScore += 5;
    else if (avgWindSpeed > 10) weatherRiskScore += 3;
    else weatherRiskScore += 1;

    // Freeze-thaw cycles damage roofing materials
    if (freezeThawCycles > 80) weatherRiskScore += 5;
    else if (freezeThawCycles > 40) weatherRiskScore += 3;
    else weatherRiskScore += 1;
  }

  // Disaster Score (0-15)
  if (data.disasters) {
    sources.push('fema');
    const { totalDeclarations, stormDeclarations } = data.disasters;

    // More storm declarations = more insurance claims = more roofing work
    if (stormDeclarations > 10) disasterScore += 10;
    else if (stormDeclarations > 5) disasterScore += 7;
    else if (stormDeclarations > 2) disasterScore += 4;
    else disasterScore += 1;

    // General disaster activity
    disasterScore += Math.min(5, Math.round(totalDeclarations / 3));
  }

  // Business Score (0-10)
  if (data.businessClimate) {
    sources.push('sba');
    const { sbaLoansCount, businessGrowthRate } = data.businessClimate;

    // Active SBA lending = healthy small business environment
    if (sbaLoansCount > 500) businessScore += 5;
    else if (sbaLoansCount > 200) businessScore += 3;
    else businessScore += 1;

    // Growing business area
    if (businessGrowthRate > 5) businessScore += 5;
    else if (businessGrowthRate > 2) businessScore += 3;
    else businessScore += 1;
  }

  const totalScore = Math.min(100, Math.round(
    propertyScore + demographicScore + weatherRiskScore + disasterScore + businessScore
  ));

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (totalScore >= 80) grade = 'A';
  else if (totalScore >= 65) grade = 'B';
  else if (totalScore >= 50) grade = 'C';
  else if (totalScore >= 35) grade = 'D';
  else grade = 'F';

  const recommendation = generateRecommendation(grade, totalScore, weatherRiskScore, propertyScore);

  return {
    zip: data.zip,
    totalScore,
    breakdown: {
      propertyScore: Math.round(propertyScore),
      demographicScore: Math.round(demographicScore),
      weatherRiskScore: Math.round(weatherRiskScore),
      disasterScore: Math.round(disasterScore),
      businessScore: Math.round(businessScore),
    },
    grade,
    recommendation,
    dataSources: sources,
  };
}

function generateRecommendation(grade: string, score: number, weatherScore: number, propertyScore: number): string {
  if (grade === 'A') {
    return `Premium territory (${score}/100). Strong demand drivers across all dimensions. Prioritize for canvassing and insurance restoration work.`;
  }
  if (grade === 'B') {
    if (weatherScore > 20) return `High storm exposure territory (${score}/100). Focus on storm damage restoration and insurance claims.`;
    if (propertyScore > 18) return `High-value property territory (${score}/100). Target premium re-roofing and upgrades.`;
    return `Solid territory (${score}/100). Good balance of demand drivers. Standard market approach recommended.`;
  }
  if (grade === 'C') {
    return `Average territory (${score}/100). Selective approach — focus on storm events and aged roof inventory.`;
  }
  if (grade === 'D') {
    return `Below average territory (${score}/100). Limited demand drivers. Consider as expansion only with strong local relationships.`;
  }
  return `Low priority territory (${score}/100). Insufficient demand drivers for dedicated coverage.`;
}

// CR3 American Exteriors territory ZIP codes
// Seacoast FL: 13 territories, West Coast FL: 10 territories
export const CR3_TERRITORY_ZIPS: Record<string, string[]> = {
  'seacoast_fl': [
    '33401', '33460', '33480', '33404', '33407', // Palm Beach area
    '33062', '33060', '33064', '33071',           // Pompano/Deerfield
    '34990', '34994', '34996', '34997',           // Stuart/Port St. Lucie
  ],
  'west_coast_fl': [
    '33901', '33903', '33907', '33908', '33912', // Fort Myers
    '34102', '34103', '34108', '34109', '34110', // Naples
  ],
};

export function getAllCR3Zips(): string[] {
  return [
    ...CR3_TERRITORY_ZIPS.seacoast_fl,
    ...CR3_TERRITORY_ZIPS.west_coast_fl,
  ];
}
