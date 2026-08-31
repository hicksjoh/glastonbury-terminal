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

  // export const GET = someIdentifier  OR  export { someIdentifier as GET }
  const aliasMatch =
    src.match(/export\s+const\s+GET\s*=\s*([A-Za-z_$][\w$]*)\s*;/) ||
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

const offenders = [];
for (const file of walk(API_ROOT)) {
  const src = readFileSync(file, 'utf8');
  const shape = getExportShape(src);
  const optedOut = /export\s+const\s+dynamic\s*=|export\s+const\s+revalidate\s*=/.test(src);
  if (shape === 'paramless' && !optedOut) offenders.push(file);
}

if (offenders.length > 0) {
  console.error('✗ Routes whose GET never reads the request and has no dynamic/revalidate export');
  console.error('  (these will be FROZEN at build time on Vercel):\n');
  for (const f of offenders) console.error(`  - ${f}`);
  console.error("\n  Fix: add `export const dynamic = 'force-dynamic';` to each route.");
  process.exit(1);
}
console.log('✓ No static-cache-vulnerable API routes.');
