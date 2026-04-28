// Healthchecks.io deadman pings for cron routes.
//
// Setup (one-time, outside this repo):
//   1. Create a project "Glastonbury Terminal" at https://healthchecks.io
//   2. Copy the project ping key
//   3. Set HEALTHCHECKS_PING_KEY in Vercel env (Production + Preview)
//   4. Configure integrations (email → hicksjoh@gmail.com, optional SMS)
//
// After deploy, each cron's first run auto-creates a check named `<slug>`.
// Schedule for each check is configured in Healthchecks UI (grace period etc).
//
// Usage in a cron route:
//   await pingHealthcheck('cron-storm-watch', 'start');
//   try { ...work...; await pingHealthcheck('cron-storm-watch', 'success'); }
//   catch { await pingHealthcheck('cron-storm-watch', 'fail'); }
//
// Behavior: fire-and-forget with 5s timeout. Never throws. If the env var
// isn't configured, it silently skips — safe to deploy without setup.

const HC_BASE = 'https://hc-ping.com';
const PING_TIMEOUT_MS = 5_000;

export type HealthcheckStatus = 'success' | 'start' | 'fail';

export async function pingHealthcheck(
  slug: string,
  status: HealthcheckStatus = 'success',
): Promise<void> {
  const key = process.env.HEALTHCHECKS_PING_KEY;
  if (!key) return;

  const suffix = status === 'success' ? '' : `/${status}`;
  const url = `${HC_BASE}/${key}/${slug}${suffix}?create=1`;

  try {
    await fetch(url, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
  } catch {
    // A failed ping must never break the cron. Ping failures are a
    // monitoring-system problem, not a business-logic problem.
  }
}
