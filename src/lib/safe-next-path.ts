// Honor `?next=<path>` so OAuth redirects (and any future "log in to
// continue" flows) land back where the user started instead of bouncing
// to the dashboard. We restrict `next` to same-origin paths to avoid
// open-redirect into a phishing site.
// Any https origin works for the server pass: only same-origin-ness is
// tested and only the path is returned, so the result is identical.
const SERVER_PLACEHOLDER_ORIGIN = 'https://terminal.invalid';

export function safeNextPath(
  raw: string | null,
  origin: string = typeof window === 'undefined' ? SERVER_PLACEHOLDER_ORIGIN : window.location.origin,
): string {
  if (!raw) return '/';
  // Must start with "/" and not "//" or "/\" (which browsers treat as
  // protocol-relative URLs to other hosts).
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/';
  }
  // Control characters and backslashes anywhere are refused outright: URL
  // parsers strip tabs and newlines, so "/\t/evil.example" becomes
  // "//evil.example" — a protocol-relative jump to another host.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  // Final word goes to the parser the browser will actually use: resolve
  // against our own origin and require that it stays there.
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/';
    const out = `${url.pathname}${url.search}${url.hash}`;
    // Normalisation can itself manufacture a protocol-relative path:
    // "/.//evil.example" resolves to pathname "//evil.example". Re-check what
    // we are about to hand to the browser, not just what came in.
    if (out.startsWith('//') || new URL(out, origin).origin !== origin) return '/';
    return out;
  } catch {
    return '/';
  }
}
