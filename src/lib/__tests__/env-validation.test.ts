import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gemini round-3 P0 — boot-time env validation.
 *
 * The router previously read `process.env.X!` lazily at request time. A
 * Vercel deploy with a missing key would only surface at 3am when an
 * unsuspecting cron hit it. `validateEnv()` fails fast on boot so the
 * deploy never serves a single request.
 *
 * Test coverage:
 *   - happy path: every required var set → no throw
 *   - each missing in turn → throws with the var name in the message
 *   - prod-only vars (SESSION_SECRET, CRON_SECRET, RESEND_ALLOWED_RECIPIENTS)
 *     are optional in non-prod, required in NODE_ENV=production
 *   - build phase (NEXT_PHASE=phase-production-build) tolerated — `next build`
 *     walks every module to collect metadata and must not crash there
 */
// Cast helper: Next 14's ambient `process.env.NODE_ENV` is typed as a
// read-only literal union. The runtime is plain Node, so we coerce
// through a wider type to mutate it in tests.
function mutableEnv(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

describe('validateEnv', () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL };
    // Clear so tests have a known starting state. Build phase + prod gate
    // are toggled per-test.
    delete mutableEnv().NEXT_PHASE;
    delete mutableEnv().NODE_ENV;
  });

  afterEach(() => {
    process.env = ORIGINAL;
    vi.resetModules();
  });

  function setAllRequired() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    process.env.ALPACA_API_KEY = 'PK-x';
    process.env.ALPACA_SECRET_KEY = 'secret';
    process.env.FMP_API_KEY = 'fmp';
    process.env.APP_PASSWORD = 'pw';
  }

  function setAllProdRequired() {
    process.env.SESSION_SECRET = 'session-secret';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.RESEND_ALLOWED_RECIPIENTS = 'a@b.com';
  }

  it('passes when every required var is set (non-prod)', async () => {
    setAllRequired();
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('passes when every required + prod-required var is set (prod)', async () => {
    setAllRequired();
    setAllProdRequired();
    mutableEnv().NODE_ENV = 'production';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    setAllRequired();
    delete process.env.ANTHROPIC_API_KEY;
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    setAllRequired();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('throws when ALPACA_API_KEY is missing', async () => {
    setAllRequired();
    delete process.env.ALPACA_API_KEY;
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/ALPACA_API_KEY/);
  });

  it('throws when APP_PASSWORD is missing', async () => {
    setAllRequired();
    delete process.env.APP_PASSWORD;
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/APP_PASSWORD/);
  });

  it('lists every missing var in a single throw message', async () => {
    setAllRequired();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.FMP_API_KEY;
    delete process.env.APP_PASSWORD;
    const { validateEnv } = await import('../env');
    try {
      validateEnv();
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/ANTHROPIC_API_KEY/);
      expect(msg).toMatch(/FMP_API_KEY/);
      expect(msg).toMatch(/APP_PASSWORD/);
    }
  });

  it('does NOT enforce prod-only vars when NODE_ENV !== production', async () => {
    setAllRequired();
    // SESSION_SECRET etc. are deliberately unset; we're in dev/preview.
    mutableEnv().NODE_ENV = 'development';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('enforces SESSION_SECRET when NODE_ENV=production', async () => {
    setAllRequired();
    setAllProdRequired();
    delete process.env.SESSION_SECRET;
    mutableEnv().NODE_ENV = 'production';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/SESSION_SECRET/);
  });

  it('enforces CRON_SECRET when NODE_ENV=production', async () => {
    setAllRequired();
    setAllProdRequired();
    delete process.env.CRON_SECRET;
    mutableEnv().NODE_ENV = 'production';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/CRON_SECRET/);
  });

  it('enforces RESEND_ALLOWED_RECIPIENTS when NODE_ENV=production', async () => {
    setAllRequired();
    setAllProdRequired();
    delete process.env.RESEND_ALLOWED_RECIPIENTS;
    mutableEnv().NODE_ENV = 'production';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).toThrow(/RESEND_ALLOWED_RECIPIENTS/);
  });

  it('returns silently (no throw) when NEXT_PHASE=phase-production-build, even with everything missing', async () => {
    // build phase walks the module graph to collect metadata; must not crash
    // even on a CI runner with zero secrets configured.
    process.env.NEXT_PHASE = 'phase-production-build';
    mutableEnv().NODE_ENV = 'production';
    const { validateEnv } = await import('../env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('exports the audited variable lists so callers can spot-check coverage', async () => {
    const mod = await import('../env');
    expect(mod.__TEST_REQUIRED_VARS).toContain('ANTHROPIC_API_KEY');
    expect(mod.__TEST_REQUIRED_VARS).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(mod.__TEST_REQUIRED_VARS).toContain('ALPACA_API_KEY');
    expect(mod.__TEST_REQUIRED_VARS).toContain('ALPACA_SECRET_KEY');
    expect(mod.__TEST_REQUIRED_VARS).toContain('FMP_API_KEY');
    expect(mod.__TEST_REQUIRED_VARS).toContain('APP_PASSWORD');
    expect(mod.__TEST_PROD_REQUIRED_VARS).toContain('SESSION_SECRET');
    expect(mod.__TEST_PROD_REQUIRED_VARS).toContain('CRON_SECRET');
    expect(mod.__TEST_PROD_REQUIRED_VARS).toContain('RESEND_ALLOWED_RECIPIENTS');
  });
});
