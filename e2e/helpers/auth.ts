import { Page } from '@playwright/test';

/**
 * Log in via the /api/auth/login endpoint and set the auth cookie.
 * Requires E2E_PASSWORD; credentials are never embedded in the suite.
 */
export async function login(page: Page) {
  const baseURL = page.context().pages()[0]?.url()
    ? new URL(page.url()).origin
    : (process.env.E2E_BASE_URL || 'https://terminal.johnwesleyhicks.com');

  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('E2E_PASSWORD is required to log in during e2e tests.');

  // Hit the login API to get the auth cookie
  const response = await page.context().request.post(`${baseURL}/api/auth/login`, {
    data: { password },
  });

  if (response.status() !== 200) {
    throw new Error(`Login failed with status ${response.status()}`);
  }
}
