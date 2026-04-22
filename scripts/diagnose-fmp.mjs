#!/usr/bin/env node
// Diagnostic: probe FMP /stable endpoints we might migrate from /api/v3.
// Run: node --env-file=.env.local scripts/diagnose-fmp.mjs

const key = process.env.FMP_API_KEY;
if (!key) {
  console.error('FMP_API_KEY is not set. Aborting.');
  process.exit(1);
}

const tests = [
  // Quote family
  { label: 'stable/quote AAPL', url: `https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${key}` },
  { label: 'stable/quote ^VIX', url: `https://financialmodelingprep.com/stable/quote?symbol=^VIX&apikey=${key}` },
  { label: 'stable/quote batch AAPL,MSFT,GOOGL', url: `https://financialmodelingprep.com/stable/quote?symbol=AAPL,MSFT,GOOGL&apikey=${key}` },
  // Profile
  { label: 'stable/profile AAPL', url: `https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=${key}` },
  // Historical prices
  { label: 'stable/historical-price-full AAPL', url: `https://financialmodelingprep.com/stable/historical-price-full?symbol=AAPL&apikey=${key}` },
  { label: 'stable/historical-price-eod/light AAPL', url: `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=AAPL&apikey=${key}` },
  { label: 'stable/historical-price-eod/full AAPL', url: `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=AAPL&apikey=${key}` },
  // Stock price change
  { label: 'stable/stock-price-change AAPL', url: `https://financialmodelingprep.com/stable/stock-price-change?symbol=AAPL&apikey=${key}` },
  // Earnings call transcripts
  { label: 'stable/earning-call-transcript AAPL 2025 Q4', url: `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=AAPL&year=2025&quarter=4&apikey=${key}` },
  { label: 'stable/earning_call_transcript AAPL', url: `https://financialmodelingprep.com/stable/earning_call_transcript?symbol=AAPL&year=2025&quarter=4&apikey=${key}` },
  // News
  { label: 'stable/stock-news', url: `https://financialmodelingprep.com/stable/stock-news?limit=5&apikey=${key}` },
  { label: 'stable/news/stock', url: `https://financialmodelingprep.com/stable/news/stock?limit=5&apikey=${key}` },
  // SEC filings
  { label: 'stable/sec-filings AAPL', url: `https://financialmodelingprep.com/stable/sec-filings?symbol=AAPL&limit=5&apikey=${key}` },
  { label: 'stable/sec_filings AAPL', url: `https://financialmodelingprep.com/stable/sec_filings?symbol=AAPL&limit=5&apikey=${key}` },
  // Options chain
  { label: 'stable/options-chain AAPL', url: `https://financialmodelingprep.com/stable/options-chain?symbol=AAPL&apikey=${key}` },
  { label: 'stable/options/chain AAPL', url: `https://financialmodelingprep.com/stable/options/chain?symbol=AAPL&apikey=${key}` },
];

for (const t of tests) {
  try {
    const res = await fetch(t.url, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    const preview = body.slice(0, 180).replace(/\s+/g, ' ');
    console.log(`[${res.status}] ${t.label}`);
    console.log(`  └── ${preview}`);
  } catch (err) {
    console.log(`[ERR] ${t.label} — ${err.message}`);
  }
}
