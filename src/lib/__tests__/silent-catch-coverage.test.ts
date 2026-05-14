import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Gemini round-3 P0+P1 — silent error swallows now log via pino.
 *
 * Three known sites were `catch {}` (or close enough). Each was masking
 * a class of upstream failure that would otherwise be visible in the
 * Logtail/Sentry pipeline:
 *
 *   1. src/app/api/keisha/actions/route.ts (add_watchlist getProfile)
 *   2. src/app/api/img/route.ts (reader.cancel during oversize-body abort)
 *   3. src/lib/api-error.ts (Sentry capture inside captureAndPublic +
 *      captureRouteError)
 *
 * The fixes don't change route behavior — they just attach a `log.warn`
 * to the catch arm. This test guards against regression by asserting:
 *   - the file no longer contains the exact `catch {}` empty pattern at
 *     the named site
 *   - the file imports a logger
 *   - a `log.warn` call exists near the patched location
 */

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(__dirname, '../../..', rel), 'utf8');
}

/**
 * Strip `// ...` line comments and `/* ... *\/` block comments so the
 * "no bare catch {}" assertion isn't fooled by a comment that legitimately
 * documents the pre-fix shape (e.g. `// was bare catch {}`).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('silent-catch coverage', () => {
  it('src/app/api/keisha/actions/route.ts no longer has a bare catch {} around getProfile', async () => {
    const raw = await readSrc('src/app/api/keisha/actions/route.ts');
    const src = stripComments(raw);
    // Find the add_watchlist getProfile invocation (await getProfile(...)) and
    // assert there's no empty catch in the immediate vicinity. The import
    // statement matches getProfile too — skip it by anchoring on `await getProfile`.
    const idx = src.indexOf('await getProfile');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 600);
    expect(slice).not.toMatch(/catch\s*\{\s*\}/);
    // Must include a log.warn near the affected branch.
    expect(slice).toMatch(/log\.warn/);
  });

  it('src/app/api/img/route.ts logs when reader.cancel throws', async () => {
    const raw = await readSrc('src/app/api/img/route.ts');
    const src = stripComments(raw);
    const idx = src.indexOf('reader.cancel');
    const slice = src.slice(idx, idx + 600);
    // The line right after reader.cancel must NOT be `catch {}`.
    expect(slice).not.toMatch(/reader\.cancel\(\);?\s*\}\s*catch\s*\{\s*\}/);
    // Logger import is required for the file to compile after the patch.
    expect(raw).toMatch(/loggerFor|from\s+['"]@\/lib\/logger['"]/);
    // The catch arm includes log.warn.
    expect(slice).toMatch(/log\.warn/);
  });

  it('src/lib/api-error.ts logs Sentry capture failures', async () => {
    const raw = await readSrc('src/lib/api-error.ts');
    // Imports the pino logger.
    expect(raw).toMatch(/from\s+['"]@\/lib\/logger['"]/);
    // Strip comments so the "bare catch {}" check ignores comments that
    // intentionally reference the pre-fix shape.
    const src = stripComments(raw);
    expect(src).not.toMatch(/catch\s*\{\s*\}/);
    // Both Sentry call sites must log via log.warn. `match` returns an
    // array of strings (or null) — friendlier to older ts targets than
    // spreading the iterator from matchAll.
    const warnHits = src.match(/log\.warn/g) ?? [];
    expect(warnHits.length).toBeGreaterThanOrEqual(2);
  });
});
