import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Codex round-3 P1 — OAuth client-id enumeration oracle.
 *
 * Pre-fix, /api/oauth/authorize returned:
 *   - "Unknown client_id"                            ← when client not found
 *   - "redirect_uri does not match any registered…"  ← when client found,
 *                                                      redirect mismatched
 *
 * An attacker can enumerate which client_ids exist by sending requests
 * with garbage redirect_uris and watching which response strings come
 * back. We collapse both branches into a single 'invalid_client_or_redirect'
 * so the response is constant regardless of which path failed.
 *
 * Strategy: lint the source — both branches must emit the SAME error
 * literal. A runtime test would need a Supabase client, mocked or real;
 * the source-level invariant is cheaper and equally load-bearing.
 */
describe('OAuth /authorize differential-error oracle', () => {
  it('unknown-client branch and bad-redirect branch return the same generic message', async () => {
    const src = await readFile(
      resolve(__dirname, '../route.ts'),
      'utf8',
    );

    // The collapsed implementation must use ONE error literal across
    // both client-missing/revoked and redirect-mismatch branches.
    const genericLiteral = 'invalid_client_or_redirect';

    // Both arms must include the generic literal.
    const occurrences = src.match(/invalid_client_or_redirect/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    // Neither of the old, differentiated messages may appear in source
    // anymore. (We allow them in comments referring to the pre-fix
    // behavior — those use the words "Unknown client_id" inside a comment
    // block, not as a `badRequest('...')` argument, so the precise
    // function-call shape is what we forbid.)
    expect(src).not.toMatch(/badRequest\(\s*['"]Unknown client_id['"]/);
    expect(src).not.toMatch(/badRequest\(\s*['"]redirect_uri does not match/);

    // Sanity — the literal is the generic one.
    expect(genericLiteral).toBe('invalid_client_or_redirect');
  });

  it('client-found-but-wrong-redirect uses same response as client-unknown', async () => {
    // Pre-validation errors ("Missing client_id", "Missing redirect_uri")
    // are a different class — those fire when the request can't even be
    // routed to a lookup, so there's no info leak there. What matters is
    // the post-lookup branches: client-not-found, client-revoked, and
    // client-found-redirect-mismatch all return the same literal.
    const src = await readFile(
      resolve(__dirname, '../route.ts'),
      'utf8',
    );

    // The condition `if (!client || client.revoked_at)` is one block
    // and the condition on `redirect_uris.includes` is another. Both must
    // emit `invalid_client_or_redirect`.
    const noClientBlock = src.match(/if\s*\(\s*!client\s*\|\|\s*client\.revoked_at[\s\S]*?return\s+badRequest\([^)]+\)/);
    const badRedirectBlock = src.match(/if\s*\(!client\.redirect_uris\.includes[\s\S]*?return\s+badRequest\([^)]+\)/);
    expect(noClientBlock?.[0]).toMatch(/invalid_client_or_redirect/);
    expect(badRedirectBlock?.[0]).toMatch(/invalid_client_or_redirect/);
  });
});
