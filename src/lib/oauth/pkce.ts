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

/**
 * Returns true iff SHA256(verifier) base64url-encoded === challenge.
 * Edge-runtime compatible (uses Web Crypto). Constant-time compare on
 * matching-length strings; falls through to mismatch on length difference.
 */
export async function verifyS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  if (
    typeof codeVerifier !== 'string' ||
    typeof codeChallenge !== 'string' ||
    codeVerifier.length < 43 ||
    codeVerifier.length > 128
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
