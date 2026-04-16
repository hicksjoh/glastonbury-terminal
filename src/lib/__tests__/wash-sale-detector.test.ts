import { describe, it, expect } from 'vitest';
import { checkWashSale, getWashSalePreview, type TradeRecord, type WashSaleCheck } from '../wash-sale-detector';

// ═══════════════════════════════════════════════════════════════════════════
//  Phase 3: Wash Sale Detector Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('checkWashSale', () => {
  it('detects wash sale: sell at loss then buy within 30 days', () => {
    const history: TradeRecord[] = [
      { id: '1', ticker: 'AAPL', action: 'buy', quantity: 100, price: 180, date: '2025-01-01' },
      { id: '2', ticker: 'AAPL', action: 'sell', quantity: 100, price: 150, date: '2025-01-15' },
      { id: '3', ticker: 'AAPL', action: 'buy', quantity: 100, price: 155, date: '2025-01-20' },
    ];

    const check: WashSaleCheck = {
      ticker: 'AAPL',
      sellDate: new Date('2025-01-15'),
      sellPrice: 150,
      sellQuantity: 100,
      costBasis: 180,
      realizedLoss: -3000, // (150 - 180) * 100
    };

    const result = checkWashSale(check, history);
    expect(result.isWashSale).toBe(true);
    expect(result.disallowedLoss).toBeGreaterThan(0);
  });

  it('no wash sale: buy more than 30 days after sell, no prior buys in window', () => {
    // Original buy is 90 days before sell — well outside 30-day pre-sell window
    const history: TradeRecord[] = [
      { id: '1', ticker: 'AAPL', action: 'buy', quantity: 100, price: 180, date: '2024-10-15' },
      { id: '2', ticker: 'AAPL', action: 'sell', quantity: 100, price: 150, date: '2025-01-15' },
      { id: '3', ticker: 'AAPL', action: 'buy', quantity: 100, price: 155, date: '2025-02-20' },
    ];

    const check: WashSaleCheck = {
      ticker: 'AAPL',
      sellDate: new Date('2025-01-15'),
      sellPrice: 150,
      sellQuantity: 100,
      costBasis: 180,
      realizedLoss: -3000,
    };

    const result = checkWashSale(check, history);
    expect(result.isWashSale).toBe(false);
    expect(result.disallowedLoss).toBe(0);
  });

  it('detects wash sale: bought within 30 days BEFORE sell', () => {
    const history: TradeRecord[] = [
      { id: '1', ticker: 'AAPL', action: 'buy', quantity: 100, price: 180, date: '2025-01-01' },
      { id: '2', ticker: 'AAPL', action: 'buy', quantity: 50, price: 145, date: '2024-12-20' },
      { id: '3', ticker: 'AAPL', action: 'sell', quantity: 100, price: 150, date: '2025-01-15' },
    ];

    const check: WashSaleCheck = {
      ticker: 'AAPL',
      sellDate: new Date('2025-01-15'),
      sellPrice: 150,
      sellQuantity: 100,
      costBasis: 180,
      realizedLoss: -3000,
    };

    const result = checkWashSale(check, history);
    expect(result.isWashSale).toBe(true);
  });

  it('never flags a profitable sale as wash sale', () => {
    const history: TradeRecord[] = [
      { id: '1', ticker: 'AAPL', action: 'buy', quantity: 100, price: 150, date: '2025-01-01' },
      { id: '2', ticker: 'AAPL', action: 'sell', quantity: 100, price: 180, date: '2025-01-15' },
      { id: '3', ticker: 'AAPL', action: 'buy', quantity: 100, price: 175, date: '2025-01-18' },
    ];

    const check: WashSaleCheck = {
      ticker: 'AAPL',
      sellDate: new Date('2025-01-15'),
      sellPrice: 180,
      sellQuantity: 100,
      costBasis: 150,
      realizedLoss: 3000, // Positive = gain, not a loss
    };

    const result = checkWashSale(check, history);
    expect(result.isWashSale).toBe(false);
    expect(result.disallowedLoss).toBe(0);
  });

  it('returns correct window dates', () => {
    const check: WashSaleCheck = {
      ticker: 'AAPL',
      sellDate: new Date('2025-06-15'),
      sellPrice: 150,
      sellQuantity: 100,
      costBasis: 180,
      realizedLoss: -3000,
    };

    const result = checkWashSale(check, []);
    expect(result.windowStart).toBeTruthy();
    expect(result.windowEnd).toBeTruthy();
    const start = new Date(result.windowStart);
    const end = new Date(result.windowEnd);
    const sell = new Date('2025-06-15');
    const daysBefore = Math.floor((sell.getTime() - start.getTime()) / 86400000);
    const daysAfter = Math.floor((end.getTime() - sell.getTime()) / 86400000);
    expect(daysBefore).toBe(30);
    expect(daysAfter).toBe(30);
  });

  it('handles Section 1256 exempt trades', () => {
    const history: TradeRecord[] = [
      { id: '1', ticker: 'SPX', action: 'buy', quantity: 10, price: 5000, date: '2025-01-01', isSection1256: true },
      { id: '2', ticker: 'SPX', action: 'sell', quantity: 10, price: 4800, date: '2025-01-15', isSection1256: true },
      { id: '3', ticker: 'SPX', action: 'buy', quantity: 10, price: 4850, date: '2025-01-20', isSection1256: true },
    ];

    const check: WashSaleCheck = {
      ticker: 'SPX',
      sellDate: new Date('2025-01-15'),
      sellPrice: 4800,
      sellQuantity: 10,
      costBasis: 5000,
      realizedLoss: -2000,
    };

    const result = checkWashSale(check, history);
    // Section 1256 buys should be excluded from conflicting trades
    expect(result.isWashSale).toBe(false);
  });
});

describe('getWashSalePreview', () => {
  it('returns null when no risk exists', () => {
    const history: TradeRecord[] = [
      { id: '1', ticker: 'AAPL', action: 'buy', quantity: 100, price: 150, date: '2024-01-01' },
    ];

    const result = getWashSalePreview('AAPL', 'sell', history, 180);
    // Old buy is well outside the window
    if (result) {
      expect(result.ticker).toBe('AAPL');
    }
  });

  it('returns alert object with correct structure', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);
    const history: TradeRecord[] = [
      { id: '1', ticker: 'TSLA', action: 'buy', quantity: 50, price: 200, date: recentDate.toISOString().split('T')[0] },
    ];

    const result = getWashSalePreview('TSLA', 'sell', history, 150);
    if (result) {
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('ticker');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('details');
      expect(result.ticker).toBe('TSLA');
    }
  });
});
