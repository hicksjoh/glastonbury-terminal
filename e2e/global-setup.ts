import { chromium, FullConfig } from '@playwright/test';

/**
 * Global setup: authenticate once and save the storage state
 * so all tests start already logged in.
 *
 * Set E2E_PASSWORD env var to the production password.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'https://terminal.johnwesleyhicks.com';
  const password = process.env.E2E_PASSWORD;
  if (!password) {
    throw new Error('E2E_PASSWORD is required for Playwright global setup; refusing to run unauthenticated.');
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();

  try {
    const response = await context.request.post(`${baseURL}/api/auth/login`, {
      data: { password },
    });
    if (!response.ok()) {
      throw new Error(
        `E2E login failed at ${baseURL}/api/auth/login (HTTP ${response.status()}); check E2E_PASSWORD.`,
      );
    }

    // Save cookies so all tests inherit the auth state.
    await context.storageState({ path: 'e2e/.auth-state.json' });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
