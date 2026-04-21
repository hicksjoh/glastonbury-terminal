#!/usr/bin/env node
// Diagnostic: hit FMP /stable sector candidates to find the correct path.
// Run: node --env-file=.env.local scripts/diagnose-fmp.mjs

const key = process.env.FMP_API_KEY;
if (!key) {
  console.error('FMP_API_KEY is not set. Aborting.');
  process.exit(1);
}

const tests = [
  { label: 'stable/sector-performance', url: `https://financialmodelingprep.com/stable/sector-performance?apikey=${key}` },
  { label: 'stable/sector-performance-snapshot', url: `https://financialmodelingprep.com/stable/sector-performance-snapshot?apikey=${key}` },
  { label: 'stable/sectors-performance', url: `https://financialmodelingprep.com/stable/sectors-performance?apikey=${key}` },
  { label: 'stable/sector-performance-snapshot?date=2026-04-17', url: `https://financialmodelingprep.com/stable/sector-performance-snapshot?date=2026-04-17&apikey=${key}` },
  { label: 'stable/sector-snapshot', url: `https://financialmodelingprep.com/stable/sector-snapshot?apikey=${key}` },
  { label: 'stable/sectors-snapshot', url: `https://financialmodelingprep.com/stable/sectors-snapshot?apikey=${key}` },
  { label: 'stable/historical-sector-performance', url: `https://financialmodelingprep.com/stable/historical-sector-performance?apikey=${key}` },
  { label: 'stable/sector-pe-snapshot', url: `https://financialmodelingprep.com/stable/sector-pe-snapshot?date=2026-04-17&apikey=${key}` },
  { label: 'stable/industry-performance-snapshot', url: `https://financialmodelingprep.com/stable/industry-performance-snapshot?date=2026-04-17&apikey=${key}` },
];

for (const t of tests) {
  try {
    const res = await fetch(t.url, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    const preview = body.slice(0, 260).replace(/\s+/g, ' ');
    console.log(`[${res.status}] ${t.label}`);
    console.log(`  └── ${preview}`);
  } catch (err) {
    console.log(`[ERR] ${t.label} — ${err.message}`);
  }
}
