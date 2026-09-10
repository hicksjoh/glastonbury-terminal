#!/usr/bin/env node
/**
 * Schema contract guard.
 *
 * Every `.from('<table>')` in src/ is a promise that the table exists in the
 * database the app actually talks to. Nothing in the repo enforced that, and
 * on 2026-09-09 the gap cost us: `portfolio_snapshots` was missing three
 * columns and `briefings` did not exist at all, so a Vercel cron had been
 * 500ing for months while the e2e suite stayed green.
 *
 * The failure mode is quiet by construction:
 *   - `CREATE TABLE IF NOT EXISTS` skips column additions to an existing table
 *   - many call sites wrap the query in try/catch and degrade to empty
 *   - Postgres reports only the FIRST missing column of a select
 *
 * So we ask the database directly, via PostgREST:
 *   200 -> table exists
 *   404 -> table missing            (PGRST205)
 *   400 -> table exists, column missing (Postgres 42703)
 *
 * Usage:
 *   node scripts/check-supabase-tables.mjs
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Locally these
 * come from .env.local; in CI add them as repo secrets. Without them the
 * script SKIPS loudly (exit 0) rather than passing silently — an unrunnable
 * guard must never look like a green one.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEnvLocal() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.log('⏭  SKIP check-supabase-tables: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  console.log('   This guard cannot run without them. Add them as CI secrets to arm it.');
  process.exit(0);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// table -> Set of files referencing it
const refs = new Map();
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\.from\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]\s*\)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(file);
  }
}

const tables = [...refs.keys()].sort();
console.log(`Checking ${tables.length} tables referenced by src/ against ${new global.URL(URL_).host}\n`);

const missing = [];
await Promise.all(tables.map(async (t) => {
  const res = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.status !== 200) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* non-JSON */ }
    missing.push({ table: t, status: res.status, msg, files: [...refs.get(t)] });
  }
}));

if (missing.length === 0) {
  console.log(`✓ All ${tables.length} referenced tables exist.`);
  process.exit(0);
}

console.error(`✗ ${missing.length} referenced table(s) missing from the database:\n`);
for (const m of missing.sort((a, b) => a.table.localeCompare(b.table))) {
  console.error(`  ${m.table}  (HTTP ${m.status}) ${m.msg}`);
  for (const f of m.files.slice(0, 4)) console.error(`      ← ${f}`);
}
console.error('\nA table referenced by code but absent from the DB is a route that 500s,');
console.error('or worse, one that swallows the error and silently returns nothing.');
process.exit(1);
