import { describe, it, expect } from 'vitest';
import { selectLots, compareLotMethods, getAvailableQuantity, type TaxLot } from '../tax-lot-optimizer';

// ═══════════════════════════════════════════════════════════════════════════
//  Phase 4: Tax Lot Optimizer Tests
// ═══════════════════════════════════════════════════════════════════════════

const threeLots: TaxLot[] = [
  { id: 'lot-1', ticker: 'AAPL', buyDate: new Date('2024-01-15'), quantity: 50, costBasis: 150, currentPrice: 200 },
  { id: 'lot-2', ticker: 'AAPL', buyDate: new Date('2024-06-15'), quantity: 50, costBasis: 180, currentPrice: 200 },
  { id: 'lot-3', ticker: 'AAPL', buyDate: new Date('2025-01-15'), quantity: 50, costBasis: 210, currentPrice: 200 },
];

describe('selectLots', () => {
  it('FIFO selects oldest lots first', () => {
    const result = selectLots(threeLots, 50, 'fifo');
    expect(result.selectedLots.length).toBeGreaterThan(0);
    // FIFO = oldest first = lot-1 (bought Jan 2024)
    expect(result.selectedLots[0].lot.id).toBe('lot-1');
    expect(result.method).toBe('fifo');
  });

  it('LIFO selects newest lots first', () => {
    const result = selectLots(threeLots, 50, 'lifo');
    expect(result.selectedLots.length).toBeGreaterThan(0);
    // LIFO = newest first = lot-3 (bought Jan 2025)
    expect(result.selectedLots[0].lot.id).toBe('lot-3');
  });

  it('HIFO selects highest cost basis first', () => {
    const result = selectLots(threeLots, 50, 'hifo');
    expect(result.selectedLots.length).toBeGreaterThan(0);
    // HIFO = highest cost first = lot-3 ($210 cost)
    expect(result.selectedLots[0].lot.id).toBe('lot-3');
    expect(result.selectedLots[0].lot.costBasis).toBe(210);
  });

  it('handles selling more than one lot', () => {
    const result = selectLots(threeLots, 80, 'fifo');
    // Need 80 shares: lot-1 (50) + lot-2 (30 of 50)
    expect(result.selectedLots.length).toBe(2);
    const totalQty = result.selectedLots.reduce((s, l) => s + l.quantityToSell, 0);
    expect(totalQty).toBe(80);
  });

  it('returns correct gain/loss per selected lot', () => {
    // lot-1: cost $150, current $200, selling 50 shares → gain $2,500
    const result = selectLots(threeLots, 50, 'fifo');
    const firstLot = result.selectedLots[0];
    expect(firstLot.gainLoss).toBeCloseTo((200 - 150) * 50, 0);
  });

  it('handles selling at a loss (HIFO with higher basis)', () => {
    // lot-3: cost $210, current $200 → loss of $10/share
    const result = selectLots(threeLots, 50, 'hifo');
    expect(result.totalGainLoss).toBeLessThan(0);
  });
});

describe('compareLotMethods', () => {
  it('compares all 4 methods', () => {
    const result = compareLotMethods(threeLots, 50);
    expect(result.methods.fifo).toBeTruthy();
    expect(result.methods.lifo).toBeTruthy();
    expect(result.methods.hifo).toBeTruthy();
    expect(result.methods.specific).toBeTruthy();
  });

  it('identifies best and worst methods', () => {
    const result = compareLotMethods(threeLots, 50);
    expect(result.bestMethod).toBeTruthy();
    expect(result.worstMethod).toBeTruthy();
    expect(result.bestMethod).not.toBe(result.worstMethod);
  });

  it('calculates maxSavings between best and worst', () => {
    const result = compareLotMethods(threeLots, 50);
    expect(result.maxSavings).toBeGreaterThanOrEqual(0);
    // Max savings = worst tax - best tax
    const bestTax = result.methods[result.bestMethod].totalTaxEstimate;
    const worstTax = result.methods[result.worstMethod].totalTaxEstimate;
    expect(result.maxSavings).toBeCloseTo(worstTax - bestTax, 0);
  });

  it('different methods produce different tax estimates', () => {
    const result = compareLotMethods(threeLots, 50);
    const fifoTax = result.methods.fifo.totalTaxEstimate;
    const hifoTax = result.methods.hifo.totalTaxEstimate;
    // FIFO (oldest, lowest cost $150) should have MORE gain → MORE tax
    // HIFO (highest cost $210) has LOSS → LESS tax
    expect(fifoTax).toBeGreaterThan(hifoTax);
  });
});

describe('getAvailableQuantity', () => {
  it('sums quantity across all lots for a ticker', () => {
    const qty = getAvailableQuantity(threeLots, 'AAPL');
    expect(qty).toBe(150); // 50 + 50 + 50
  });

  it('returns 0 for unknown ticker', () => {
    const qty = getAvailableQuantity(threeLots, 'MSFT');
    expect(qty).toBe(0);
  });
});
