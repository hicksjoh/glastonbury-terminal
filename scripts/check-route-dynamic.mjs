#!/usr/bin/env node
// Guard against the static-cache bug class (2026-08-30): a GET handler that
// never reads the request in an App Router route file gets statically
// optimized at build time, and Vercel then serves a frozen snapshot forever —
// /api/health and /api/narrative shipped that way and sat stale for 4 weeks.
// Every API route in this app serves live or per-user data, so any route whose
// GET never reads the request must explicitly opt out with
// `export const dynamic = 'force-dynamic'` (or declare `revalidate`).
// Note "never reads the request" is stricter than "takes no parameters": an
// unused `_req` counts as not reading it.
//
// Detected GET export forms:
//   export async function GET() {...}
//   export const GET = async () => {...} / export const GET = function () {...}
//   export { handle as GET }  /  export const GET = handle   (resolves the
//     aliased declaration in the same file and checks ITS parameter list)
// Run in CI; exits 1 with the offending files.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = 'src/app/api';
const APP_ROOT = 'src/app';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

// Extract the handler body by brace-matching forward from the END of the
// signature. Starting at the signature itself would latch onto the `{ params }`
// destructuring brace instead of the body.
function bodyAfter(src, fromIndex) {
  const open = src.indexOf('{', fromIndex);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

// Does the handler actually READ the request?
//
// Declaring a parameter is not the same as using it. `GET(_req, { params })`
// never touches the request, so Next still statically optimizes it — that is
// how /api/share/[token] shipped cacheable and kept serving a revoked share
// token forever. So resolve the first parameter's identifier and require that
// the GET body genuinely references it.
function readsRequest(src, params, declIndex) {
  const first = params.split(',')[0]?.trim();
  if (!first) return false;

  // Strip a type annotation / default value, then take the identifier.
  const ident = first.split(':')[0].split('=')[0].trim();

  // A destructured first arg is not a request, and `_`-prefixed means unused.
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) return false;
  if (ident.startsWith('_')) return false;

  // Only count references inside the GET body. Counting file-wide would let a
  // POST/DELETE that happens to name its own parameter `req` vouch for a GET
  // that never touches it.
  const body = bodyAfter(src, declIndex);
  return new RegExp(`\\b${ident}\\b`).test(body);
}

// Returns 'paramless' | 'has-params' | null (no GET export found)
function getExportShape(src) {
  let m;

  // export async function GET(<params>)
  m = src.match(/export\s+(?:async\s+)?function\s+GET\s*\(([^)]*)\)/);
  if (m) return readsRequest(src, m[1], m.index + m[0].length) ? 'has-params' : 'paramless';

  // export const GET = async (<params>) => / = function (<params>)
  m = src.match(/export\s+const\s+GET\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)/);
  if (m) return readsRequest(src, m[1], m.index + m[0].length) ? 'has-params' : 'paramless';

  // export const GET = someIdentifier
  // export { someIdentifier as GET }
  // export const GET = withRateLimit('slug', RATE.X, someIdentifier)  <- the
  //   rate-limit wrapper. Without this case every wrapped route parsed as
  //   "no recognised GET export" and was skipped entirely, silently switching
  //   this guard off for 89 routes the moment the wrapper was introduced.
  const aliasMatch =
    src.match(/export\s+const\s+GET\s*=\s*([A-Za-z_$][\w$]*)\s*;/) ||
    src.match(/export\s+const\s+GET\s*=\s*\w+\s*\([^)]*?,\s*([A-Za-z_$][\w$]*)\s*\)\s*;/) ||
    src.match(/export\s*\{[^}]*\b([A-Za-z_$][\w$]*)\s+as\s+GET\b[^}]*\}/);
  if (aliasMatch) {
    const name = aliasMatch[1];
    const decl =
      src.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)`)) ||
      src.match(new RegExp(`const\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(([^)]*)\\)`));
    // Unresolvable alias: fail conservative — require an explicit opt-out.
    if (!decl) return 'paramless';
    return readsRequest(src, decl[1], decl.index + decl[0].length) ? 'has-params' : 'paramless';
  }

  return null;
}

// ── Part 2: pages that bake a clock reading into their prerender ──────────
//
// The original guard scanned src/app/api only, and the exact same bug class
// then shipped one directory over: src/app/page.tsx computed `new Date()` in
// its render body, Next statically prerendered the page at build time, and
// production served an HTML snapshot reading "Wednesday, September 9, 2026"
// for five days straight. The browser hydrated with the real date, which is
// React #425 on every single load.
//
// A clock/random reading in a page's RENDER path (as opposed to inside a hook
// callback, where it runs per-mount on the client) is either frozen at build
// time or divergent between the server and the browser. Both are bugs. Opt out
// per line with a trailing `// prerender-safe: <reason>` when the call
// genuinely cannot reach the prerendered output.
const CLOCK_CALL = /\b(new Date\(\s*\)|Date\.now\(\)|Math\.random\(\))/;
const PAGE_OPT_OUT = /\/\/\s*prerender-safe:/;

function walkPages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkPages(p, out);
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

/**
 * Report clock/random calls that execute on EVERY render of the page component
 * — i.e. in the component body itself, outside any nested function.
 *
 * Deliberately narrow. Calls inside module-level helpers (`timeAgo`), event
 * handlers, hook callbacks and `.map()` bodies either never run during SSR or
 * only run against data that arrives after mount, so flagging them produces
 * noise — and a guard that cries wolf gets silenced, which is how the last one
 * rotted. Only the render-body case can be frozen into the prerendered HTML.
 *
 * Opt out per line with a trailing `// prerender-safe: <reason>`.
 */
function clockCallsInRenderPath(src) {
  const m = src.match(/export\s+default\s+(?:async\s+)?function\s+\w*\s*\([^)]*\)\s*\{/);
  if (!m) return [];

  const bodyStart = m.index + m[0].length;
  const hits = [];
  let depth = 0;          // brace depth relative to the component body
  let nestedFnAt = null;  // depth at which the innermost nested function opened

  const lines = src.slice(bodyStart).split('\n');
  const lineOffset = src.slice(0, bodyStart).split('\n').length;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = raw.replace(/\/\/.*$/, '');

    if (depth === 0 && nestedFnAt === null
        && CLOCK_CALL.test(code) && !PAGE_OPT_OUT.test(raw)) {
      hits.push({ line: lineOffset + i, text: raw.trim() });
    }

    // A line that opens a callback or function literal starts a nested scope.
    const opensNested = /(=>\s*\{|\bfunction\b[^;]*\{)/.test(code);
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;

    if (opensNested && nestedFnAt === null) nestedFnAt = depth;
    depth += opens - closes;
    if (nestedFnAt !== null && depth <= nestedFnAt) nestedFnAt = null;
    if (depth < 0) break; // walked out of the component body
  }
  return hits;
}

const pageOffenders = [];
for (const file of walkPages(APP_ROOT)) {
  if (file.includes(`${APP_ROOT}/api/`)) continue;
  const hits = clockCallsInRenderPath(readFileSync(file, 'utf8'));
  if (hits.length > 0) pageOffenders.push({ file, hits });
}

const offenders = [];
for (const file of walk(API_ROOT)) {
  const src = readFileSync(file, 'utf8');
  const shape = getExportShape(src);
  const optedOut = /export\s+const\s+dynamic\s*=|export\s+const\s+revalidate\s*=/.test(src);
  if (shape === 'paramless' && !optedOut) offenders.push(file);
}

let failed = false;

if (offenders.length > 0) {
  failed = true;
  console.error('✗ Routes whose GET never reads the request and has no dynamic/revalidate export');
  console.error('  (these will be FROZEN at build time on Vercel):\n');
  for (const f of offenders) console.error(`  - ${f}`);
  console.error("\n  Fix: add `export const dynamic = 'force-dynamic';` to each route.");
}

if (pageOffenders.length > 0) {
  failed = true;
  console.error('\n✗ Pages reading the clock (or Math.random) in the render path');
  console.error('  (frozen at build time in the prerender, then mismatched on hydration):\n');
  for (const { file, hits } of pageOffenders) {
    for (const h of hits) console.error(`  - ${file}:${h.line}  ${h.text}`);
  }
  console.error('\n  Fix: compute it in a useEffect and render a placeholder until mounted');
  console.error('  (see the greeting in src/app/page.tsx, or MarketStatusChip),');
  console.error('  or annotate the line `// prerender-safe: <reason>` if it truly cannot reach SSR.');
}

if (failed) process.exit(1);
console.log(`✓ No static-cache-vulnerable API routes; no clock reads in ${walkPages(APP_ROOT).filter(f => !f.includes(`${APP_ROOT}/api/`)).length} page render paths.`);
