const DEFAULT_MAX_HOURS = 48;

export function isBriefingStale(
  createdAt: string | Date | null | undefined,
  maxHours: number = DEFAULT_MAX_HOURS,
): boolean {
  if (createdAt === null || createdAt === undefined || createdAt === '') {
    return true;
  }

  const parsed = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  const ageMs = Date.now() - parsed.getTime();
  const maxMs = maxHours * 60 * 60 * 1000;
  return ageMs > maxMs;
}

export { DEFAULT_MAX_HOURS as BRIEFING_DEFAULT_MAX_HOURS };
