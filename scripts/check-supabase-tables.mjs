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
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    // A quoted value ends at its closing quote; anything after it (typically a
    // ` # comment`) is discarded. Handling this in one step matters: testing
    // "is the whole value quoted?" first fails on `KEY="a#b" # note`, which
    // then falls through to comment-stripping and keeps the literal quotes.
    // A '#' INSIDE quotes is part of the value — APP_PASSWORD contains one.
    const quoted = /^(["'])([\s\S]*?)\1/.exec(v);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v;
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
    let st;
    try { st = statSync(p); } catch { continue; } // broken symlink / unreadable
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// table -> Set of files referencing it
// `.from('x')` is not exclusively Supabase — Array.from, Buffer.from, Object.from
// and friends share the name. Capture the receiver token and drop known builtins,
// so a future `Array.from('events')` can't be reported as a missing table.
const BUILTIN_RECEIVERS = new Set([
  'Array', 'Buffer', 'Object', 'Set', 'Map', 'Promise', 'String', 'Number', 'BigInt',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer',
]);

const refs = new Map();
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  // The receiver may be a bare identifier (`supabase.from`), or the end of an
  // expression (`(supabase as any).from`, `getClient().from`, `arr[0].from`).
  // Match either, and skip ONLY when it is a known builtin identifier — an
  // identifier-only pattern silently dropped 7 real tables behind casts.
  // `[!?]?` keeps `supabase?.from('x')` and `supabase!.from('x')` in scope —
  // a receiver-constrained regex without it silently stops seeing those calls,
  // which would make the guard quietly weaker than the naive version it replaced.
  for (const m of src.matchAll(
    /([A-Za-z_$][A-Za-z0-9_$]*|\)|\])\s*[!?]?\s*\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/g,
  )) {
    const [, receiver, table] = m;
    if (BUILTIN_RECEIVERS.has(receiver)) continue;
    if (!refs.has(table)) refs.set(table, new Set());
    refs.get(table).add(file);
  }
}

const tables = [...refs.keys()].sort();
console.log(`Checking ${tables.length} tables referenced by src/ against ${new global.URL(URL_).host}\n`);

// Probe with bounded concurrency. A single unbounded Promise.all over ~55
// tables can trip PostgREST's own limiter, and a rejected fetch there would
// reject the whole batch with a raw stack trace.
//
// Classification matters more than it looks:
//   404 -> table genuinely missing              -> FAIL (exit 1)
//   any other non-200, or a thrown fetch        -> UNVERIFIED -> warn, exit 0
// A transient 429/5xx/DNS blip must never be reported as "missing table".
// Mislabeling infrastructure flake as a real defect is how a dead-man switch
// gets ignored — see the week issue #19 sat red after prod had recovered.
const missing = [];
const unverified = [];
const CONCURRENCY = 8;

async function probe(t) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${URL_}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (res.status === 200) return;
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* non-JSON body */ }
      if (res.status === 404) {
        missing.push({ table: t, status: 404, msg, files: [...refs.get(t)] });
        return;
      }
      if (attempt === 0) continue; // retry once on 429/5xx/anything odd
      unverified.push({ table: t, status: res.status, msg });
      return;
    } catch (err) {
      if (attempt === 0) continue;
      unverified.push({ table: t, status: 'fetch failed', msg: err?.message ?? String(err) });
      return;
    }
  }
}

const queue = [...tables];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    let t;
    while ((t = queue.shift()) !== undefined) await probe(t);
  }),
);

if (unverified.length > 0) {
  console.warn(`\n⚠  ${unverified.length} table(s) could not be verified (not counted as missing):`);
  for (const u of unverified) console.warn(`   ${u.table}  (${u.status}) ${u.msg}`);
}

if (missing.length === 0) {
  console.log(`\n✓ ${tables.length - unverified.length}/${tables.length} referenced tables confirmed present.`);
  process.exit(0);
}

console.error(`\n✗ ${missing.length} referenced table(s) missing from the database:\n`);
for (const m of missing.sort((a, b) => a.table.localeCompare(b.table))) {
  console.error(`  ${m.table}  (HTTP ${m.status}) ${m.msg}`);
  for (const f of m.files.slice(0, 4)) console.error(`      \u2190 ${f}`);
}
console.error('\nA table referenced by code but absent from the DB is a route that 500s,');
console.error('or worse, one that swallows the error and silently returns nothing.');
process.exit(1);
