#!/usr/bin/env node
// Guard against the static-cache bug class (2026-08-30): a GET handler that
// never reads the request in an App Router route file gets statically
// optimized at build time, and Vercel then serves a frozen snapshot forever —
// /api/health and /api/narrative shipped that way and sat stale for 4 weeks.
// Every API route in this app serves live or per-user data, so any route
// exporting a GET with an empty parameter list must explicitly opt out with
// `export const dynamic = 'force-dynamic'` (or declare `revalidate`).
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

// Returns 'paramless' | 'has-params' | null (no GET export found)
function getExportShape(src) {
  let m;

  // export async function GET(<params>)
  m = src.match(/export\s+(?:async\s+)?function\s+GET\s*\(([^)]*)\)/);
  if (m) return m[1].trim() === '' ? 'paramless' : 'has-params';

  // export const GET = async (<params>) => / = function (<params>)
  m = src.match(/export\s+const\s+GET\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)/);
  if (m) return m[1].trim() === '' ? 'paramless' : 'has-params';

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
    return decl[1].trim() === '' ? 'paramless' : 'has-params';
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
  console.error('✗ Routes with a parameterless GET export and no dynamic/revalidate export');
  console.error('  (these will be FROZEN at build time on Vercel):\n');
  for (const f of offenders) console.error(`  - ${f}`);
  console.error("\n  Fix: add `export const dynamic = 'force-dynamic';` to each route.");
  process.exit(1);
}
console.log('✓ No static-cache-vulnerable API routes.');
