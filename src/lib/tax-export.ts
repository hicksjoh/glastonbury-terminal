// ═══════════════════════════════════════════════════════════════════════════
//  Tax Export — Form 8949 / Schedule D data generation + CSV export
//  IRS-ready format compatible with TurboTax and TaxAct import
// ═══════════════════════════════════════════════════════════════════════════

import { classifyHoldingPeriod, TAX_DISCLAIMER, type TaxYearData, ACTIVE_TAX_YEAR, type FilingStatus } from './tax-engine';
import type { TradeRecord } from './wash-sale-detector';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Form8949Row {
  description: string;           // "100 sh AAPL"
  dateAcquired: string;          // MM/DD/YYYY
  dateSold: string;              // MM/DD/YYYY
  proceeds: number;
  costBasis: number;
  adjustmentCode: string;        // 'W' for wash sale, 'B' for basis not reported, '' for none
  adjustmentAmount: number;
  gainOrLoss: number;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  // A: ST reported to IRS    D: LT reported to IRS
  // B: ST not reported        E: LT not reported
  // C: ST no 1099             F: LT no 1099
}

export interface ScheduleDSummary {
  shortTermGains: number;
  shortTermLosses: number;
  shortTermNet: number;
  longTermGains: number;
  longTermLosses: number;
  longTermNet: number;
  totalNet: number;
  lossCarryforward: number;
  washSaleAdjustments: number;
  disclaimer: string;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function formatDateMMDDYYYY(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Match sells to buys using FIFO order for a given ticker.
 * Returns paired trade records for 8949 rows.
 */
interface MatchedTrade {
  ticker: string;
  buyDate: string;
  sellDate: string;
  quantity: number;
  proceeds: number;
  costBasis: number;
  isWashSale: boolean;
  washSaleAdjustment: number;
}

function matchTrades(trades: TradeRecord[], taxYear: number): MatchedTrade[] {
  // Group by ticker
  const byTicker: Record<string, { buys: TradeRecord[]; sells: TradeRecord[] }> = {};
  for (const t of trades) {
    const yr = new Date(t.date).getFullYear();
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { buys: [], sells: [] };
    if (t.action === 'buy') {
      byTicker[t.ticker].buys.push(t);
    } else if (yr === taxYear) {
      // Only include sells from the target tax year
      byTicker[t.ticker].sells.push(t);
    }
  }

  const matched: MatchedTrade[] = [];

  for (const [ticker, { buys, sells }] of Object.entries(byTicker)) {
    // Sort buys FIFO (oldest first)
    const buyQueue = [...buys].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Sort sells chronologically
    const sortedSells = [...sells].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let buyIdx = 0;
    let buyRemaining = buyQueue[buyIdx]?.quantity || 0;

    for (const sell of sortedSells) {
      let sellRemaining = sell.quantity;

      while (sellRemaining > 0 && buyIdx < buyQueue.length) {
        const qty = Math.min(sellRemaining, buyRemaining);
        const proceeds = qty * sell.price;
        const costBasis = qty * buyQueue[buyIdx].price;

        // Simple wash sale detection: if there's a buy within 30 days after this sell at a loss
        let isWashSale = false;
        let washAdj = 0;
        const gainLoss = proceeds - costBasis;

        if (gainLoss < 0) {
          const sellDate = new Date(sell.date);
          const windowEnd = new Date(sellDate);
          windowEnd.setDate(windowEnd.getDate() + 30);

          for (const b of buys) {
            const bDate = new Date(b.date);
            if (b.ticker === ticker && bDate > sellDate && bDate <= windowEnd) {
              isWashSale = true;
              washAdj = Math.abs(gainLoss);
              break;
            }
          }
        }

        matched.push({
          ticker,
          buyDate: buyQueue[buyIdx].date,
          sellDate: sell.date,
          quantity: qty,
          proceeds: Math.round(proceeds * 100) / 100,
          costBasis: Math.round(costBasis * 100) / 100,
          isWashSale,
          washSaleAdjustment: Math.round(washAdj * 100) / 100,
        });

        sellRemaining -= qty;
        buyRemaining -= qty;

        if (buyRemaining <= 0) {
          buyIdx++;
          buyRemaining = buyQueue[buyIdx]?.quantity || 0;
        }
      }

      // If no matching buys found (short sale or missing data), create row with "Various" date
      if (sellRemaining > 0) {
        matched.push({
          ticker,
          buyDate: 'Various',
          sellDate: sell.date,
          quantity: sellRemaining,
          proceeds: Math.round(sellRemaining * sell.price * 100) / 100,
          costBasis: 0,
          isWashSale: false,
          washSaleAdjustment: 0,
        });
      }
    }
  }

  return matched.sort((a, b) => new Date(a.sellDate).getTime() - new Date(b.sellDate).getTime());
}

// ─── Public Functions ───────────────────────────────────────────────────────

/**
 * Generate Form 8949 row data from trade records.
 * Matches buys to sells using FIFO, detects wash sales, classifies ST/LT.
 */
export function generateForm8949Data(
  trades: TradeRecord[],
  taxYear: number,
  taxYearData: TaxYearData = ACTIVE_TAX_YEAR,
): Form8949Row[] {
  const matched = matchTrades(trades, taxYear);

  return matched.map(m => {
    const holding = m.buyDate !== 'Various'
      ? classifyHoldingPeriod(m.buyDate, m.sellDate, taxYearData)
      : null;

    const isLongTerm = holding ? holding.type === 'long_term' : false;
    const gainOrLoss = m.proceeds - m.costBasis + (m.isWashSale ? m.washSaleAdjustment : 0);

    // Category: assume broker-reported (A/D). Use B/E for not-reported.
    let category: Form8949Row['category'];
    if (isLongTerm) {
      category = m.costBasis > 0 ? 'D' : 'E'; // D = LT reported, E = LT not reported
    } else {
      category = m.costBasis > 0 ? 'A' : 'B'; // A = ST reported, B = ST not reported
    }

    return {
      description: `${m.quantity} sh ${m.ticker}`,
      dateAcquired: m.buyDate === 'Various' ? 'VARIOUS' : formatDateMMDDYYYY(m.buyDate),
      dateSold: formatDateMMDDYYYY(m.sellDate),
      proceeds: m.proceeds,
      costBasis: m.costBasis,
      adjustmentCode: m.isWashSale ? 'W' : '',
      adjustmentAmount: m.isWashSale ? m.washSaleAdjustment : 0,
      gainOrLoss: Math.round(gainOrLoss * 100) / 100,
      category,
    };
  });
}

/**
 * Generate CSV string in TurboTax-compatible format.
 * Headers match IRS Form 8949 columns.
 */
export function exportForm8949CSV(data: Form8949Row[]): string {
  const headers = [
    'Description of Property',
    'Date Acquired',
    'Date Sold',
    'Proceeds',
    'Cost or Other Basis',
    'Code(s)',
    'Adjustment Amount',
    'Gain or (Loss)',
    'Category',
  ];

  const rows = data.map(row => [
    `"${row.description}"`,
    row.dateAcquired,
    row.dateSold,
    row.proceeds.toFixed(2),
    row.costBasis.toFixed(2),
    row.adjustmentCode,
    row.adjustmentAmount > 0 ? row.adjustmentAmount.toFixed(2) : '',
    row.gainOrLoss.toFixed(2),
    row.category,
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generate Schedule D summary from Form 8949 data.
 */
export function generateScheduleDSummary(
  data: Form8949Row[],
  filingStatus: FilingStatus = 'single',
  taxYearData: TaxYearData = ACTIVE_TAX_YEAR,
): ScheduleDSummary {
  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;
  let washSaleAdjustments = 0;

  for (const row of data) {
    const isLT = row.category === 'D' || row.category === 'E' || row.category === 'F';

    if (row.adjustmentCode === 'W') {
      washSaleAdjustments += row.adjustmentAmount;
    }

    if (isLT) {
      if (row.gainOrLoss >= 0) longTermGains += row.gainOrLoss;
      else longTermLosses += row.gainOrLoss;
    } else {
      if (row.gainOrLoss >= 0) shortTermGains += row.gainOrLoss;
      else shortTermLosses += row.gainOrLoss;
    }
  }

  const shortTermNet = Math.round((shortTermGains + shortTermLosses) * 100) / 100;
  const longTermNet = Math.round((longTermGains + longTermLosses) * 100) / 100;
  const totalNet = Math.round((shortTermNet + longTermNet) * 100) / 100;

  // Loss carryforward: losses exceeding $3K deduction limit
  const lossLimit = taxYearData.lossDeductionLimit[filingStatus];
  const lossCarryforward = totalNet < 0 ? Math.max(0, Math.abs(totalNet) - lossLimit) : 0;

  return {
    shortTermGains: Math.round(shortTermGains * 100) / 100,
    shortTermLosses: Math.round(shortTermLosses * 100) / 100,
    shortTermNet,
    longTermGains: Math.round(longTermGains * 100) / 100,
    longTermLosses: Math.round(longTermLosses * 100) / 100,
    longTermNet,
    totalNet,
    lossCarryforward: Math.round(lossCarryforward * 100) / 100,
    washSaleAdjustments: Math.round(washSaleAdjustments * 100) / 100,
    disclaimer: TAX_DISCLAIMER,
  };
}
