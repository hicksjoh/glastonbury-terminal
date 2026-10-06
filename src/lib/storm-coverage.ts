/**
 * How much of the CR3 footprint storm watch can actually see.
 *
 * Storm matching is ZIP-based, so a territory with no ZIPs can never be flagged,
 * and a territory with no row is not watched at all. The card used to print
 * "All clear · 13 Seacoast FL territories monitored" while 10 West Coast FL
 * territories had no rows and 3 of the 13 had no ZIPs — an all-clear that
 * covered 10 of 23 (QA 2026-10-05, finding 10).
 */

/** Seacoast FL (13) + West Coast FL (10) area-rep agreements. */
export const CR3_TOTAL_TERRITORIES = 23;

export interface StormCoverage {
  expected: number;
  /** Territories with at least one ZIP: the only ones a storm can match. */
  monitored: number;
  /** Rows that exist but have no ZIPs. */
  missingZips: string[];
  /** Territories with no row at all. */
  notConfigured: number;
  complete: boolean;
}

export function summarizeStormCoverage(
  territories: { territory_id: string; zip_codes: string[] | null }[],
  expected: number = CR3_TOTAL_TERRITORIES,
): StormCoverage {
  const missingZips = territories
    .filter((t) => !t.zip_codes || t.zip_codes.length === 0)
    .map((t) => t.territory_id);
  const monitored = territories.length - missingZips.length;
  const notConfigured = Math.max(0, expected - territories.length);
  return {
    expected,
    monitored,
    missingZips,
    notConfigured,
    complete: monitored >= expected,
  };
}
