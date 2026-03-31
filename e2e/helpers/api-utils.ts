import { APIRequestContext, expect } from '@playwright/test';

/**
 * Hit an API route and verify it returns valid JSON with expected status.
 */
export async function expectAPIReturnsJSON(
  request: APIRequestContext,
  url: string,
  expectedStatus = 200
) {
  const response = await request.get(url);
  expect(response.status()).toBe(expectedStatus);

  const contentType = response.headers()['content-type'] || '';
  expect(contentType).toContain('application/json');

  const body = await response.json();
  expect(body).toBeDefined();
  return body;
}

/**
 * Verify all fields in an API response are the expected types.
 * Catches the "Alpaca returns strings instead of numbers" class of bugs.
 */
export function expectFieldTypes(
  obj: Record<string, any>,
  schema: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>
) {
  for (const [field, expectedType] of Object.entries(schema)) {
    const value = obj[field];
    if (value === null || value === undefined) continue; // Allow nullable

    if (expectedType === 'array') {
      expect(Array.isArray(value), `${field} should be array, got ${typeof value}: ${value}`).toBe(true);
    } else if (expectedType === 'number') {
      // This is THE critical check — catches string-typed numbers from Alpaca
      expect(
        typeof value === 'number',
        `${field} should be number, got ${typeof value}: "${value}" — this will crash .toFixed()!`
      ).toBe(true);
      expect(isNaN(value), `${field} is NaN`).toBe(false);
    } else {
      expect(typeof value, `${field} type mismatch`).toBe(expectedType);
    }
  }
}
