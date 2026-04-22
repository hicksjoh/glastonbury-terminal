// SEC EDGAR helpers for the 13F whale-mirror feature (F6).
//
// All endpoints require a User-Agent header with a contact email per the
// SEC's fair-access policy (https://www.sec.gov/os/accessing-edgar-data).
// Requests go to data.sec.gov (JSON) and www.sec.gov (XML exhibits).

const DATA_BASE = 'https://data.sec.gov';
const ARCHIVE_BASE = 'https://www.sec.gov/Archives/edgar/data';

function edgarHeaders(): Record<string, string> {
  return {
    'User-Agent': 'GlastonburyTerminal/1.0 hicksjoh@gmail.com',
    Accept: 'application/json,text/xml,text/html',
  };
}

/** Ten-digit zero-padded CIK (the format EDGAR URLs expect). */
export function paddedCik(cik: string | number): string {
  return String(cik).padStart(10, '0');
}

/** Strip leading zeros (for the Archives path). */
export function trimmedCik(cik: string | number): string {
  return String(Number(cik));
}

/**
 * Pulls the filer's submissions index and returns only 13F-HR rows,
 * newest-first. 13F-NT (notice-only filings) are excluded because they
 * do not contain the holdings table.
 */
export interface FilingRef {
  accessionNumber: string;
  /** Accession with the dashes stripped — used in Archives URL paths. */
  accessionNoDashes: string;
  filingDate: string;
  /** Quarter the filing reports on, e.g. "Q4 2025". Derived from periodOfReport. */
  periodOfReport: string;
  primaryDocument: string;
  /** Constructed SEC Archives index URL (HTML). */
  indexUrl: string;
  /** Constructed info-table XML URL. Not guaranteed to exist for every filing. */
  infoTableUrl: string;
}

interface EdgarSubmissionsResponse {
  name?: string;
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      periodOfReport?: string[];
      primaryDocument?: string[];
    };
  };
}

export async function list13FHR(cik: string | number, limit = 8): Promise<FilingRef[]> {
  const padded = paddedCik(cik);
  const trimmed = trimmedCik(cik);
  const url = `${DATA_BASE}/submissions/CIK${padded}.json`;
  const res = await fetch(url, {
    headers: edgarHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as EdgarSubmissionsResponse;
  const recent = data.filings?.recent;
  if (!recent?.form) return [];

  const out: FilingRef[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== '13F-HR') continue;
    const accession = recent.accessionNumber?.[i] ?? '';
    if (!accession) continue;
    const noDashes = accession.replace(/-/g, '');
    const indexUrl = `${ARCHIVE_BASE}/${trimmed}/${noDashes}/${accession}-index.htm`;
    // The info-table XML filename is NOT standardized — each filing picks a
    // different number (e.g. "50240.xml"). We resolve the actual URL lazily
    // at fetch time. Expose the filing's index-json so fetchHoldings can
    // find the info-table without a second round-trip if cached.
    const filingIndexJsonUrl = `${ARCHIVE_BASE}/${trimmed}/${noDashes}/index.json`;
    const infoTableUrl = filingIndexJsonUrl; // sentinel — resolved by fetchHoldings
    out.push({
      accessionNumber: accession,
      accessionNoDashes: noDashes,
      filingDate: recent.filingDate?.[i] ?? '',
      periodOfReport: recent.periodOfReport?.[i] ?? '',
      primaryDocument: recent.primaryDocument?.[i] ?? '',
      indexUrl,
      infoTableUrl,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Holdings parser ─────────────────────────────────────────────────
// The 13F information table is an XML document with repeating <infoTable>
// elements. We parse with a simple regex extractor — the schema is stable
// enough that a full XML parser would be overkill, and regex keeps the
// helper Edge-runtime compatible.

export interface HoldingRow {
  nameOfIssuer: string;
  cusip: string;
  /** Value in USD (EDGAR reports in thousands; we convert here). */
  valueUsd: number;
  shares: number;
  putCall: 'Put' | 'Call' | '';
}

function extractTagContent(xml: string, tag: string): string {
  const m = new RegExp(`<[^>]*:?${tag}>([^<]*)<`, 'i').exec(xml);
  return m ? m[1].trim() : '';
}

/**
 * Resolves the actual info-table XML URL from a filing's index.json.
 * SEC doesn't use a consistent filename — we pick the first .xml that
 * isn't primary_doc.xml (which is the cover document, not the holdings).
 */
async function resolveInfoTableUrl(filingIndexJsonUrl: string): Promise<string | null> {
  try {
    const res = await fetch(filingIndexJsonUrl, {
      headers: edgarHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { directory?: { item?: Array<{ name?: string }> } };
    const items = data.directory?.item ?? [];
    const infoTable = items.find(
      i => i.name?.endsWith('.xml') && i.name !== 'primary_doc.xml',
    );
    if (!infoTable?.name) return null;
    // Resolve against the directory URL (strip trailing index.json).
    const baseDir = filingIndexJsonUrl.replace(/index\.json$/, '');
    return baseDir + infoTable.name;
  } catch {
    return null;
  }
}

export async function fetchHoldings(infoTableOrIndexUrl: string): Promise<HoldingRow[]> {
  try {
    // If we were handed the index.json sentinel, resolve to the real XML first.
    let xmlUrl = infoTableOrIndexUrl;
    if (infoTableOrIndexUrl.endsWith('/index.json')) {
      const resolved = await resolveInfoTableUrl(infoTableOrIndexUrl);
      if (!resolved) return [];
      xmlUrl = resolved;
    }
    const res = await fetch(xmlUrl, {
      headers: edgarHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.split(/<[^>]*:?infoTable>/i).slice(1);

    // Filers split positions across sub-managers (Berkshire publishes a
    // separate <infoTable> row per sub-manager for the same CUSIP). Aggregate
    // rows by CUSIP before returning so consumers see one row per position.
    const byCusip = new Map<
      string,
      { row: HoldingRow; count: number }
    >();

    for (const raw of blocks) {
      const block = raw.split(/<\/[^>]*:?infoTable>/i)[0] ?? '';
      if (!block.trim()) continue;
      const cusip = extractTagContent(block, 'cusip');
      if (!cusip) continue;
      const rawValue = Number(extractTagContent(block, 'value').replace(/,/g, ''));
      const shares = Number(extractTagContent(block, 'sshPrnamt').replace(/,/g, ''));
      const putCall = extractTagContent(block, 'putCall') as 'Put' | 'Call' | '';
      const name = extractTagContent(block, 'nameOfIssuer');
      // Since the 2022 SEC amendments (effective for filings on/after
      // 1-Oct-2023), the <value> field is reported in whole dollars. Prior
      // to that it was reported in thousands. Every filing we surface is
      // from 2024+, so treat as whole dollars.
      const valueUsd = Number.isFinite(rawValue) ? rawValue : 0;
      const sharesNum = Number.isFinite(shares) ? shares : 0;
      const existing = byCusip.get(cusip);
      if (existing) {
        existing.row.valueUsd += valueUsd;
        existing.row.shares += sharesNum;
        if (putCall === 'Put' || putCall === 'Call') existing.row.putCall = putCall;
      } else {
        byCusip.set(cusip, {
          row: {
            nameOfIssuer: name,
            cusip,
            valueUsd,
            shares: sharesNum,
            putCall: putCall === 'Put' || putCall === 'Call' ? putCall : '',
          },
          count: 1,
        });
      }
    }

    return Array.from(byCusip.values()).map(({ row }) => row);
  } catch {
    return [];
  }
}

/**
 * Computes the changes between two 13F holdings snapshots.
 * Returns: brand-new positions, sold-out-of, increased, and reduced.
 */
export interface HoldingDiff {
  newBuys: Array<{ cusip: string; name: string; shares: number; valueUsd: number }>;
  soldOut: Array<{ cusip: string; name: string; sharesPrior: number; valueUsdPrior: number }>;
  increased: Array<{ cusip: string; name: string; priorShares: number; newShares: number; changePct: number }>;
  reduced: Array<{ cusip: string; name: string; priorShares: number; newShares: number; changePct: number }>;
}

export function diffHoldings(prior: HoldingRow[], current: HoldingRow[]): HoldingDiff {
  const priorByCusip = new Map<string, HoldingRow>();
  for (const row of prior) priorByCusip.set(row.cusip, row);
  const currentByCusip = new Map<string, HoldingRow>();
  for (const row of current) currentByCusip.set(row.cusip, row);

  const newBuys: HoldingDiff['newBuys'] = [];
  const soldOut: HoldingDiff['soldOut'] = [];
  const increased: HoldingDiff['increased'] = [];
  const reduced: HoldingDiff['reduced'] = [];

  for (const c of current) {
    const p = priorByCusip.get(c.cusip);
    if (!p) {
      newBuys.push({ cusip: c.cusip, name: c.nameOfIssuer, shares: c.shares, valueUsd: c.valueUsd });
    } else if (c.shares > p.shares) {
      const changePct = p.shares > 0 ? ((c.shares - p.shares) / p.shares) * 100 : 100;
      increased.push({
        cusip: c.cusip,
        name: c.nameOfIssuer,
        priorShares: p.shares,
        newShares: c.shares,
        changePct: Math.round(changePct * 10) / 10,
      });
    } else if (c.shares < p.shares) {
      const changePct = p.shares > 0 ? ((c.shares - p.shares) / p.shares) * 100 : 0;
      reduced.push({
        cusip: c.cusip,
        name: c.nameOfIssuer,
        priorShares: p.shares,
        newShares: c.shares,
        changePct: Math.round(changePct * 10) / 10,
      });
    }
  }
  for (const p of prior) {
    if (!currentByCusip.has(p.cusip)) {
      soldOut.push({ cusip: p.cusip, name: p.nameOfIssuer, sharesPrior: p.shares, valueUsdPrior: p.valueUsd });
    }
  }

  return { newBuys, soldOut, increased, reduced };
}
