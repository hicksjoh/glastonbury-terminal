import { apiFetch, type ApiResult } from '@/lib/api-client';

type QuiverRow = Record<string, unknown>;

export interface QuiverCongressTrade {
  ticker: string;
  representative: string;
  party: string;
  state: string;
  chamber: string;
  transactionType: 'buy' | 'sell';
  amount: string;
  transactionDate: string;
  disclosureDate: string;
  filingUrl: string;
}

export interface QuiverInsiderTrade {
  symbol: string;
  name: string;
  title: string;
  transactionType: 'buy' | 'sell';
  shares: number;
  pricePerShare: number;
  totalValue: number;
  date: string;
  filingUrl: string;
}

function text(row: QuiverRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined) return String(value);
  }
  return '';
}

function number(row: QuiverRow, ...keys: string[]): number {
  const value = Number(text(row, ...keys).replace(/[$,]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function rows(data: unknown): QuiverRow[] {
  if (Array.isArray(data)) return data as QuiverRow[];
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    for (const key of ['data', 'results', 'trades']) {
      if (Array.isArray(object[key])) return object[key] as QuiverRow[];
    }
  }
  return [];
}

// Explicit code lists — an unknown or missing transaction code must NOT be
// classified as a sale (that fabricates bearish data when Quiver renames a
// field). Unknown rows return null and are quarantined by the callers.
function transactionType(value: string | undefined | null): 'buy' | 'sell' | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('purchase') || normalized.includes('buy') || normalized.includes('acquisition') || normalized === 'a' || normalized === 'p') return 'buy';
  if (normalized.includes('sale') || normalized.includes('sell') || normalized.includes('disposition') || normalized === 's' || normalized === 'd') return 'sell';
  return null;
}

export async function getQuiverCongressTrades(): Promise<ApiResult<QuiverCongressTrade[]>> {
  const result = await apiFetch<unknown>('quiver', '/live/congresstrading', {}, { cacheTtlMs: 15 * 60_000 });
  return {
    _meta: result._meta,
    data: rows(result.data).map(row => ({
      ticker: text(row, 'Ticker', 'ticker', 'Symbol', 'symbol').toUpperCase(),
      representative: text(row, 'Representative', 'representative', 'Name', 'name'),
      party: text(row, 'Party', 'party'),
      state: text(row, 'State', 'state', 'District', 'district'),
      chamber: text(row, 'House', 'house', 'Chamber', 'chamber'),
      transactionType: transactionType(text(row, 'Transaction', 'transaction', 'TransactionType', 'transaction_type', 'Type', 'type')),
      amount: text(row, 'Range', 'range', 'Amount', 'amount'),
      transactionDate: text(row, 'TransactionDate', 'transaction_date', 'Date', 'date'),
      disclosureDate: text(row, 'ReportDate', 'report_date', 'DisclosureDate', 'disclosure_date'),
      filingUrl: text(row, 'Source', 'source', 'FilingURL', 'filing_url', 'Link', 'link'),
    })).filter((trade): trade is QuiverCongressTrade => {
      if (!trade.ticker) return false;
      if (trade.transactionType === null) {
        console.warn('[quiver] quarantined congress row with unknown transaction code', trade.ticker);
        return false;
      }
      return true;
    }),
  };
}

export async function getQuiverInsiderTrades(): Promise<ApiResult<QuiverInsiderTrade[]>> {
  const result = await apiFetch<unknown>('quiver', '/live/insiders', {}, { cacheTtlMs: 15 * 60_000 });
  return {
    _meta: result._meta,
    data: rows(result.data).map(row => {
      const shares = number(row, 'Shares', 'shares', 'SecuritiesTransacted', 'securities_transacted');
      const price = number(row, 'PricePerShare', 'price_per_share', 'Price', 'price');
      return {
        symbol: text(row, 'Ticker', 'ticker', 'Symbol', 'symbol').toUpperCase(),
        name: text(row, 'Name', 'name', 'Insider', 'insider', 'ReportingName', 'reporting_name') || 'Unknown',
        title: text(row, 'Title', 'title', 'Relationship', 'relationship'),
        transactionType: transactionType(text(row, 'AcquiredDisposed', 'acquired_disposed', 'TransactionCode', 'transaction_code', 'Transaction', 'transaction')),
        shares,
        pricePerShare: price,
        totalValue: number(row, 'TotalValue', 'total_value', 'Value', 'value') || shares * price,
        date: text(row, 'Date', 'date', 'TransactionDate', 'transaction_date', 'FilingDate', 'filing_date'),
        filingUrl: text(row, 'Source', 'source', 'FilingURL', 'filing_url', 'Link', 'link'),
      };
    }).filter((trade): trade is QuiverInsiderTrade => {
      if (!trade.symbol) return false;
      if (trade.transactionType === null) {
        console.warn('[quiver] quarantined insider row with unknown transaction code', trade.symbol);
        return false;
      }
      return true;
    }),
  };
}
