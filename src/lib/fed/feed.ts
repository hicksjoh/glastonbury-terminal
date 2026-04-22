// F7 helpers — Fed press-release RSS + body extraction.
//
// Only monetary-policy statements and FOMC minutes are scored (pulls at
// federalreserve.gov/newsevents/pressreleases/ with "monetary" in the path
// map to this feed). We deliberately skip discount-rate minutes and other
// items — they're not the signal we want.

const FEED_URL = 'https://www.federalreserve.gov/feeds/press_monetary.xml';

export interface FedPressItem {
  title: string;
  url: string;
  publishedAt: string;
}

function feedHeaders(): Record<string, string> {
  return {
    'User-Agent': 'GlastonburyTerminal/1.0 hicksjoh@gmail.com',
    Accept: 'application/rss+xml,application/xml,text/xml',
  };
}

/** Parses `<item>` blocks with regex. XML is simple + stable here. */
export async function fetchFedMonetaryFeed(limit = 10): Promise<FedPressItem[]> {
  try {
    const res = await fetch(FEED_URL, {
      headers: feedHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const out: FedPressItem[] = [];
    const itemBlocks = xml.split(/<item>/).slice(1);
    for (const raw of itemBlocks) {
      const block = raw.split(/<\/item>/)[0] ?? '';
      const title = extractCdata(block, 'title');
      const url = extractCdata(block, 'link');
      const pub = extractCdata(block, 'pubDate');
      if (!title || !url) continue;
      // Filter to FOMC statements + minutes only — discount rate, press
      // conference transcripts, etc. are not the signal we want scored.
      const isFomc =
        /statement/i.test(title) ||
        /federal\s+open\s+market\s+committee/i.test(title) ||
        /minutes\s+of\s+the\s+federal\s+open\s+market\s+committee/i.test(title);
      if (!isFomc) continue;
      out.push({
        title,
        url,
        publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function extractCdata(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : '';
}

/**
 * Fetches a press-release page and extracts the main body text. The Fed's
 * pages wrap the statement body in `<div id="article">` with a predictable
 * structure — we don't need a full HTML parser, just a content window.
 */
export async function fetchPressReleaseBody(url: string, maxChars = 8_000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: feedHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    // Pull everything inside div#article and strip tags + collapse whitespace.
    const m = /<div[^>]*id=["']article["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html);
    const body = m ? m[1] : html;
    const stripped = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#8211;|&#8212;/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.slice(0, maxChars);
  } catch {
    return '';
  }
}
