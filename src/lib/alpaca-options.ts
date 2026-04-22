// Alpaca options helpers for the free "unusual flow" page (F5).
//
// The Alpaca paper/live account tier gives us:
//   - /v2/options/contracts — enumerate contracts for an underlying
//   - /v1beta1/options/snapshots — latest quote + dailyBar + Greeks + IV + OI
//
// That's enough to compute a volume/OI ratio and rank unusual-activity
// contracts per symbol. No real-time tape, no sweep/block detection, but
// it's the best we can do without a paid options-data feed.

const ALPACA_DATA_URL = 'https://data.alpaca.markets';
const ALPACA_TRADING_URL =
  process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

function headers(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY ?? '',
  };
}

export interface AlpacaOptionContract {
  symbol: string;
  underlying_symbol: string;
  expiration_date: string;
  strike_price: string;
  type: 'call' | 'put';
  open_interest?: string;
  open_interest_date?: string;
  status: 'active' | 'inactive';
}

export interface AlpacaOptionSnapshot {
  latestQuote?: { ap: number; bp: number; as: number; bs: number };
  latestTrade?: { p: number; s: number; t: string };
  dailyBar?: { v: number; o: number; h: number; l: number; c: number; n: number; vw: number; t: string };
  greeks?: { delta: number; gamma: number; theta: number; vega: number; rho: number };
  impliedVolatility?: number;
  openInterest?: number;
}

/**
 * Fetch up to `limit` active option contracts for an underlying.
 * Optionally filter by expiration date (exact match, YYYY-MM-DD).
 */
export async function listOptionContracts(
  underlying: string,
  options: { expiration?: string; limit?: number } = {},
): Promise<AlpacaOptionContract[]> {
  const params = new URLSearchParams({
    underlying_symbols: underlying.toUpperCase(),
    status: 'active',
    limit: String(options.limit ?? 500),
  });
  if (options.expiration) params.set('expiration_date', options.expiration);

  const res = await fetch(
    `${ALPACA_TRADING_URL}/v2/options/contracts?${params.toString()}`,
    { headers: headers(), signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const list = data?.option_contracts ?? data?.contracts ?? [];
  return Array.isArray(list) ? list : [];
}

/**
 * Fetch latest snapshots (quote + dailyBar + Greeks + IV + OI) for a set of
 * OCC contract symbols. Alpaca accepts up to 100 symbols per request, so
 * this helper batches internally.
 */
export async function getOptionSnapshots(
  contractSymbols: string[],
): Promise<Record<string, AlpacaOptionSnapshot>> {
  if (contractSymbols.length === 0) return {};
  const merged: Record<string, AlpacaOptionSnapshot> = {};
  for (let i = 0; i < contractSymbols.length; i += 100) {
    const batch = contractSymbols.slice(i, i + 100);
    const params = new URLSearchParams({ symbols: batch.join(',') });
    const res = await fetch(
      `${ALPACA_DATA_URL}/v1beta1/options/snapshots?${params.toString()}`,
      { headers: headers(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) continue;
    const data = await res.json();
    const snaps = data?.snapshots ?? data ?? {};
    for (const [sym, snap] of Object.entries(snaps)) {
      merged[sym] = snap as AlpacaOptionSnapshot;
    }
  }
  return merged;
}

// ─── Derived "unusual flow" ranking ───────────────────────────────────

export interface FlowCandidate {
  underlying: string;
  contract: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  /** Daily-bar volume for this contract (today or most recent trading day). */
  volume: number;
  /** Open interest (lagging by 1 day on Alpaca). */
  openInterest: number;
  /** volume / OI (> 1 means today's volume already exceeded all open contracts). */
  volOiRatio: number;
  /** vwap × volume × 100 shares/contract — rough notional premium. */
  premiumUSD: number;
  impliedVolatility: number | null;
  delta: number | null;
  direction: 'bullish' | 'bearish';
  flowType: 'sweep' | 'block' | 'unusual';
}

/**
 * Given a watchlist, pulls contracts + snapshots per symbol and returns the
 * top unusual-flow candidates across them, sorted by premium notional.
 *
 * Minimum thresholds are applied to avoid junk:
 *   - volume ≥ 100 contracts
 *   - volOiRatio ≥ 2 (today's volume at least 2x prior open interest) OR
 *     volOiRatio ≥ 1 with premium ≥ minPremiumUSD
 *   - excludes ≤7 DTE to avoid expiring-day noise
 *
 * Takes ~1 Alpaca contract call + 1 snapshot call per symbol, so keep the
 * symbol count reasonable (≤10 in dev).
 */
export async function findUnusualFlow(
  symbols: string[],
  options: {
    minVolume?: number;
    minVolOi?: number;
    minPremiumUSD?: number;
    minDte?: number;
    maxResults?: number;
  } = {},
): Promise<FlowCandidate[]> {
  const minVolume = options.minVolume ?? 100;
  const minVolOi = options.minVolOi ?? 2;
  const minPremiumUSD = options.minPremiumUSD ?? 50_000;
  const minDte = options.minDte ?? 7;
  const maxResults = options.maxResults ?? 50;

  const now = Date.now();

  const allCandidates: FlowCandidate[] = [];

  await Promise.all(
    symbols.map(async (underlying) => {
      try {
        const contracts = await listOptionContracts(underlying, { limit: 500 });
        if (contracts.length === 0) return;

        // Keep only contracts ≥ minDte days out to avoid 0-day expirations.
        const keepers = contracts.filter((c) => {
          const dte = (new Date(c.expiration_date).getTime() - now) / (1000 * 60 * 60 * 24);
          return dte >= minDte;
        });
        if (keepers.length === 0) return;

        const snapshotMap = await getOptionSnapshots(
          keepers.map((c) => c.symbol),
        );

        for (const c of keepers) {
          const snap = snapshotMap[c.symbol];
          if (!snap) continue;
          const volume = snap.dailyBar?.v ?? 0;
          if (volume < minVolume) continue;
          const oiRaw = snap.openInterest ?? Number(c.open_interest ?? 0);
          const oi = Number.isFinite(oiRaw) ? oiRaw : 0;
          const volOiRatio = oi > 0 ? volume / oi : volume;
          const vwap = snap.dailyBar?.vw ?? snap.dailyBar?.c ?? snap.latestTrade?.p ?? 0;
          const premiumUSD = Math.round(vwap * volume * 100);

          const passesRatio = volOiRatio >= minVolOi;
          const passesPremium = volOiRatio >= 1 && premiumUSD >= minPremiumUSD;
          if (!passesRatio && !passesPremium) continue;

          let flowType: 'sweep' | 'block' | 'unusual' = 'unusual';
          if (premiumUSD >= 500_000) flowType = 'sweep';
          else if (premiumUSD >= 250_000) flowType = 'block';

          allCandidates.push({
            underlying: c.underlying_symbol,
            contract: c.symbol,
            type: c.type,
            strike: Number(c.strike_price) || 0,
            expiration: c.expiration_date,
            volume,
            openInterest: oi,
            volOiRatio: Math.round(volOiRatio * 100) / 100,
            premiumUSD,
            impliedVolatility:
              typeof snap.impliedVolatility === 'number' ? snap.impliedVolatility : null,
            delta: typeof snap.greeks?.delta === 'number' ? snap.greeks.delta : null,
            direction: c.type === 'call' ? 'bullish' : 'bearish',
            flowType,
          });
        }
      } catch {
        // single-symbol failures must not break the whole scan
      }
    }),
  );

  allCandidates.sort((a, b) => b.premiumUSD - a.premiumUSD);
  return allCandidates.slice(0, maxResults);
}
