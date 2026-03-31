import { chromium, FullConfig } from '@playwright/test';

/**
 * Global setup: authenticate once and save the storage state
 * so all tests start already logged in.
 *
 * Set E2E_PASSWORD env var to the production password.
 * Falls back to trying common passwords.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'https://terminal.johnwesleyhicks.com';

  // Try passwords in order: env var, shell-interpolated version, default
  const passwords = [
    process.env.E2E_PASSWORD,
    'Glastonbury#GT!',       // shell-interpolated version ($2026 eaten)
    'Glastonbury$2026#GT!',  // intended password
    'glastonbury2026',       // fallback default
  ].filter(Boolean) as string[];

  const browser = await chromium.launch();
  const context = await browser.newContext();

  let authenticated = false;
  for (const password of passwords) {
    const response = await context.request.post(`${baseURL}/api/auth/login`, {
      data: { password },
    });
    if (response.status() === 200) {
      authenticated = true;
      break;
    }
  }

  if (!authenticated) {
    console.warn('Auth login failed with all passwords — set E2E_PASSWORD env var');
  }

  // Save cookies so all tests inherit the auth state
  await context.storageState({ path: 'e2e/.auth-state.json' });
  await browser.close();
}

export default globalSetup;
