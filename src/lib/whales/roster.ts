// Roster of institutional "superinvestors" we mirror via their 13F-HR
// filings. CIKs pulled from the SEC EDGAR entity search. Order here is
// the display order on the /whales page.
//
// Adding someone: lookup at https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany
// and confirm they actually file 13F-HR (not 13F-NT, which is a notice-only
// filing for advisors whose holdings are already in another filer's 13F).

export interface Whale {
  slug: string;
  name: string;
  /** 10-digit CIK zero-padded, matches SEC URL format. */
  cik: string;
  /** Plain-English tagline shown on the page. */
  tagline: string;
  /** Optional reference URL (website, Wikipedia). */
  reference?: string;
}

export const WHALES: Whale[] = [
  {
    slug: 'berkshire',
    name: 'Berkshire Hathaway (Warren Buffett)',
    cik: '0001067983',
    tagline: 'Value investor. Concentrated. Long-hold. Benchmark for US large-cap quality.',
    reference: 'https://www.berkshirehathaway.com',
  },
  {
    slug: 'scion',
    name: 'Scion Asset Management (Michael Burry)',
    cik: '0001649339',
    tagline: 'Contrarian short-vol. Famous for The Big Short. Small book, high signal.',
  },
  {
    slug: 'pershing-square',
    name: 'Pershing Square Capital (Bill Ackman)',
    cik: '0001336528',
    tagline: 'Concentrated activist. Long-duration wagers, macro-hedged.',
    reference: 'https://www.pershingsquarefoundation.org',
  },
  {
    slug: 'bridgewater',
    name: 'Bridgewater Associates (Ray Dalio)',
    cik: '0001350694',
    tagline: 'Global macro. All Weather + Pure Alpha. Risk-parity benchmark.',
    reference: 'https://www.bridgewater.com',
  },
  {
    slug: 'icahn',
    name: 'Icahn Enterprises (Carl Icahn)',
    cik: '0000921669',
    tagline: 'Activist raider. Concentrated, loud, decades of proxy-fight wins.',
    reference: 'https://www.ielp.com',
  },
  {
    slug: 'greenlight',
    name: 'Greenlight Capital (David Einhorn)',
    cik: '0001079114',
    tagline: 'Deep-value long/short. Known for bear calls on Allied Capital, Lehman.',
  },
  {
    slug: 'third-point',
    name: 'Third Point (Dan Loeb)',
    cik: '0001040273',
    tagline: 'Event-driven activist. Sharp letters, catalyst-heavy book.',
  },
  {
    slug: 'appaloosa',
    name: 'Appaloosa Management (David Tepper)',
    cik: '0001656456',
    tagline: 'Macro-aware concentrated equities. Hall-of-fame annualized returns.',
  },
];

export function findWhale(slug: string): Whale | null {
  return WHALES.find(w => w.slug === slug) ?? null;
}
