/**
 * Regression tests for the 2026-09-14 production QA sweep.
 *
 * Every case here corresponds to a defect that was live in production and is
 * written to fail against the old behaviour. They are deliberately grouped in
 * one file so the provenance stays obvious; each `describe` names the finding.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateAddress, isSafeImageUrl } from '@/lib/img-proxy';
import { normalizeExecutionRow } from '@/lib/autopilot-contract';
import { getTaxYearData, latestSupportedTaxYear, ACTIVE_TAX_YEAR } from '@/lib/tax-engine';

// ── M7 — image proxy SSRF ──────────────────────────────────────────────────
describe('M7 img-proxy: private address rejection', () => {
  it('rejects every private / loopback / link-local IPv4 form', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3',
      '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',   // cloud instance metadata — the classic SSRF target
      '0.0.0.0',
      '100.64.0.1',        // CGNAT
      '224.0.0.1',         // multicast
      '255.255.255.255',   // broadcast
    ]) {
      expect(isPrivateAddress(ip), `${ip} should be private`).toBe(true);
    }
  });

  it('allows ordinary public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '151.101.1.140', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(ip), `${ip} should be public`).toBe(false);
    }
  });

  it('sees through IPv4-mapped IPv6, which is how the regex guard was bypassed', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('rejects IPv6 loopback, unique-local and link-local', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), `${ip} should be private`).toBe(true);
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('isSafeImageUrl rejects bare private IP literals the hostname regex missed', () => {
    // The old BLOCKED_HOSTS regex covered 127./10./192.168./169.254./172.16-31
    // as string prefixes but nothing else.
    expect(isSafeImageUrl('http://0.0.0.0/a.png')).toBe(false);
    expect(isSafeImageUrl('http://[::ffff:127.0.0.1]/a.png')).toBe(false);
    expect(isSafeImageUrl('http://100.64.0.1/a.png')).toBe(false);
    expect(isSafeImageUrl('https://images.example.com/a.png')).toBe(true);
  });

  it('still rejects non-http protocols', () => {
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeImageUrl('gopher://example.com/')).toBe(false);
    expect(isSafeImageUrl('not a url')).toBe(false);
  });
});

// ── C7 — autopilot execution contract ──────────────────────────────────────
describe('C7 autopilot: execution rows normalise to one shape', () => {
  it('maps a real autopilot_executions row', () => {
    const row = normalizeExecutionRow({
      id: 'row-1', symbol: 'AAPL', shares: '10', side: 'BUY',
      order_id: 'ord-9', status: 'filled', filled_avg_price: '190.25',
      pipeline_id: 'ap-1', created_at: '2026-09-14T18:00:00.000Z',
    });
    expect(row).toEqual({
      id: 'row-1', symbol: 'AAPL', side: 'buy', shares: 10, price: 190.25,
      orderId: 'ord-9', orderStatus: 'filled', pipelineId: 'ap-1',
      executedAt: '2026-09-14T18:00:00.000Z',
    });
  });

  it('keeps an unfilled order price as null, never 0', () => {
    // The page formats this with `.toFixed(2)`. A 0 here would render "$0.00"
    // as though the fill happened at zero; null renders an em dash.
    const row = normalizeExecutionRow({
      id: 'r', symbol: 'SPY', shares: 1, side: 'buy',
      order_id: 'o', status: 'accepted', filled_avg_price: null,
      created_at: '2026-09-14T18:00:00.000Z',
    });
    expect(row.price).toBeNull();
  });

  it('survives a row where every nullable column is null', () => {
    const row = normalizeExecutionRow({});
    expect(row.side).toBe('buy');
    expect(row.shares).toBe(0);
    expect(row.price).toBeNull();
    expect(row.orderId).toBeNull();
    expect(typeof row.executedAt).toBe('string');
  });

  it('coerces a non-numeric price to null rather than NaN', () => {
    // NaN serialises to null over JSON anyway; making it explicit here means
    // the page's null check is the single place that has to be right.
    expect(normalizeExecutionRow({ filled_avg_price: 'n/a' }).price).toBeNull();
    expect(normalizeExecutionRow({ shares: 'abc' }).shares).toBe(0);
  });
});

// ── C9 — tax year ──────────────────────────────────────────────────────────
describe('C9 tax engine: unsupported years fail closed', () => {
  it('returns data only for years with verified IRS constants', () => {
    expect(getTaxYearData(2025)).not.toBeNull();
    expect(getTaxYearData(2025)!.year).toBe(2025);
  });

  it('returns null for a year the engine has no constants for', () => {
    // The page used to render `new Date().getFullYear()` as its heading over
    // whatever ACTIVE_TAX_YEAR happened to be, announcing "2026 Tax
    // Intelligence" on 2025 brackets. Callers must be able to detect that.
    expect(getTaxYearData(2026)).toBeNull();
    expect(getTaxYearData(1999)).toBeNull();
  });

  it('ACTIVE_TAX_YEAR is itself a supported year', () => {
    expect(getTaxYearData(ACTIVE_TAX_YEAR.year)).toBe(ACTIVE_TAX_YEAR);
    expect(latestSupportedTaxYear()).toBe(ACTIVE_TAX_YEAR.year);
  });
});
