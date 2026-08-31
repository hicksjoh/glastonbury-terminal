// PKCE S256 verification — RFC 7636.
//
// We only support S256. The 'plain' method is rejected at the authorize
// endpoint because it provides no real protection — if an attacker can
// intercept the auth code, they can also intercept the verifier.
//
// S256: the client sends `code_challenge = BASE64URL(SHA256(code_verifier))`
// at /authorize, then sends `code_verifier` (the raw secret) at /token.
// We re-hash the verifier and compare.

function base64UrlEncode(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return (typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64'))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// RFC 7636 §4.1 — code_verifier MUST be:
//   - 43 to 128 characters long
//   - composed of unreserved characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
// P1-1: previously only length was enforced. A verifier with control chars,
// non-ASCII, or NUL bytes would still hash and (if the client used the same
// bytes for the challenge) match — widening attack surface for log-injection
// and breaking the unguessable-entropy guarantee tied to the character set.
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Returns true iff SHA256(verifier) base64url-encoded === challenge.
 * Edge-runtime compatible (uses Web Crypto). Constant-time compare on
 * matching-length strings; falls through to mismatch on length difference.
 *
 * Enforces RFC 7636 §4.1 verifier character set in addition to length.
 */
export async function verifyS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  if (
    typeof codeVerifier !== 'string' ||
    typeof codeChallenge !== 'string' ||
    !VERIFIER_RE.test(codeVerifier)
  ) {
    return false;
  }
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const computed = base64UrlEncode(digest);
  if (computed.length !== codeChallenge.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ codeChallenge.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validate a code_verifier WITHOUT comparing it to a challenge. Used by
 * /api/oauth/token to short-circuit a malformed verifier BEFORE it burns
 * the (single-use) authorization code via consumeCode(). Returns true if
 * the verifier matches the RFC 7636 §4.1 shape.
 */
export function isWellFormedVerifier(s: unknown): boolean {
  return typeof s === 'string' && VERIFIER_RE.test(s);
}
