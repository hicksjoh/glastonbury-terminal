'use client';

import { useEffect, useState, useCallback } from 'react';
import type { OptionChainEntry } from '@/lib/options/types';

interface ExpirationInfo {
  date: string;
  dte: number;
  category: string;
}

interface OptionsChainProps {
  symbol: string;
  onSelectOption?: (entry: OptionChainEntry, side: 'call' | 'put') => void;
  selectedSymbol?: string;
}

function fmt(n: number, decimals = 2): string {
  if (n === 0) return '—';
  return n.toFixed(decimals);
}

function fmtVol(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function OptionsChain({ symbol, onSelectOption, selectedSymbol }: OptionsChainProps) {
  const [chain, setChain] = useState<OptionChainEntry[]>([]);
  const [expirations, setExpirations] = useState<ExpirationInfo[]>([]);
  const [selectedExp, setSelectedExp] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [strikeRange, setStrikeRange] = useState(10);
  const [stockPrice, setStockPrice] = useState(0);

  // Fetch expirations when symbol changes
  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/options/expirations/${symbol}`)
      .then(r => r.json())
      .then(data => {
        const exps: ExpirationInfo[] = data.expirations || [];
        setExpirations(exps);
        // Auto-select first expiration with 20-45 DTE, or just the first
        const ideal = exps.find(e => e.dte >= 20 && e.dte <= 45) || exps[0];
        if (ideal) setSelectedExp(ideal.date);
      })
      .catch(() => setExpirations([]));
  }, [symbol]);

  // Fetch chain when expiration changes
  const fetchChain = useCallback(async () => {
    if (!symbol || !selectedExp) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ expiration: selectedExp });
      const res = await fetch(`/api/options/chain/${symbol}?${params}`);
      const data = await res.json();
      const entries: OptionChainEntry[] = data.chain || [];
      setChain(entries);

      // Estimate stock price from ATM options
      if (entries.length > 0) {
        const strikes = Array.from(new Set(entries.map(e => e.strike))).sort((a, b) => a - b);
        const mid = strikes[Math.floor(strikes.length / 2)];
        setStockPrice(mid);
      }
    } catch {
      setChain([]);
    }
    setLoading(false);
  }, [symbol, selectedExp]);

  useEffect(() => { fetchChain(); }, [fetchChain]);

  // Also fetch stock price
  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/alpaca/market-data?symbol=${symbol}`)
      .then(r => r.json())
      .then(data => {
        if (data.quote) {
          const price = ((data.quote.ap || 0) + (data.quote.bp || 0)) / 2;
          if (price > 0) setStockPrice(price);
        }
      })
      .catch(() => {});
  }, [symbol]);

  // Get unique strikes and filter by range
  const allStrikes = Array.from(new Set(chain.map(e => e.strike))).sort((a, b) => a - b);
  const atmIndex = allStrikes.findIndex(s => s >= stockPrice);
  const startIdx = Math.max(0, atmIndex - strikeRange);
  const endIdx = Math.min(allStrikes.length, atmIndex + strikeRange + 1);
  const visibleStrikes = allStrikes.slice(startIdx, endIdx);

  // Index chain by strike + type
  const callMap = new Map<number, OptionChainEntry>();
  const putMap = new Map<number, OptionChainEntry>();
  for (const entry of chain) {
    if (entry.type === 'call') callMap.set(entry.strike, entry);
    else putMap.set(entry.strike, entry);
  }

  const headerStyle: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: 10,
    color: '#6b6b80',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontWeight: 600,
  };

  const cellStyle: React.CSSProperties = {
    padding: '7px 8px',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: 'right',
    color: '#c8c8d0',
    whiteSpace: 'nowrap',
  };

  const getRowBg = (strike: number, isHover: boolean): string => {
    const isATM = Math.abs(strike - stockPrice) <= (stockPrice * 0.005);
    if (isATM) return 'rgba(138, 92, 246, 0.12)';
    if (isHover) return 'rgba(255,255,255,0.03)';
    return 'transparent';
  };

  const isITM = (strike: number, type: 'call' | 'put'): boolean => {
    return type === 'call' ? stockPrice > strike : stockPrice < strike;
  };

  return (
    <div>
      {/* Expiration Selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 8,
          scrollbarWidth: 'thin',
        }}>
          {expirations.map(exp => (
            <button
              key={exp.date}
              onClick={() => setSelectedExp(exp.date)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: selectedExp === exp.date ? '1px solid #c9a84c' : '1px solid #2a2a3a',
                background: selectedExp === exp.date ? 'rgba(201, 168, 76, 0.15)' : '#1a1a2e',
                color: selectedExp === exp.date ? '#c9a84c' : '#888',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {formatExpLabel(exp.date)} <span style={{ color: '#555', fontSize: 10 }}>({exp.dte}d)</span>
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#6b6b80' }}>
          {symbol} @ <span style={{ color: '#c9a84c', fontFamily: "'JetBrains Mono', monospace" }}>${stockPrice.toFixed(2)}</span>
          {' '}&bull; {chain.length} contracts
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b6b80' }}>Strikes:</span>
          <select
            value={strikeRange}
            onChange={e => setStrikeRange(parseInt(e.target.value))}
            style={{
              background: '#1a1a2e',
              border: '1px solid #2a2a3a',
              borderRadius: 6,
              color: '#c8c8d0',
              fontSize: 11,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            {[5, 10, 15, 20, 30].map(n => (
              <option key={n} value={n}>±{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chain Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b6b80', fontSize: 13 }}>
          Loading options chain...
        </div>
      ) : chain.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#6b6b80', fontSize: 13 }}>
          {symbol ? 'No options data available for this symbol' : 'Enter a symbol to view options chain'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2a2a3a' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #2a2a3a', background: '#12121a' }}>
                {/* Call headers */}
                <th style={{ ...headerStyle, textAlign: 'center', color: '#4ade80' }} colSpan={7}>CALLS</th>
                {/* Strike */}
                <th style={{ ...headerStyle, textAlign: 'center', color: '#c9a84c', borderLeft: '2px solid #2a2a3a', borderRight: '2px solid #2a2a3a' }}>STRIKE</th>
                {/* Put headers */}
                <th style={{ ...headerStyle, textAlign: 'center', color: '#ef4444' }} colSpan={7}>PUTS</th>
              </tr>
              <tr style={{ borderBottom: '1px solid #2a2a3a', background: '#12121a' }}>
                {['Bid', 'Ask', 'Last', 'Vol', 'OI', 'IV', 'Δ'].map(h => (
                  <th key={`c-${h}`} style={headerStyle}>{h}</th>
                ))}
                <th style={{ ...headerStyle, textAlign: 'center', borderLeft: '2px solid #2a2a3a', borderRight: '2px solid #2a2a3a' }}></th>
                {['Δ', 'IV', 'OI', 'Vol', 'Last', 'Ask', 'Bid'].map(h => (
                  <th key={`p-${h}`} style={{ ...headerStyle, textAlign: h === 'Δ' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleStrikes.map(strike => {
                const call = callMap.get(strike);
                const put = putMap.get(strike);
                const isATM = Math.abs(strike - stockPrice) <= (stockPrice * 0.005);
                const callITM = isITM(strike, 'call');
                const putITM = isITM(strike, 'put');
                const isCallSelected = call?.symbol === selectedSymbol;
                const isPutSelected = put?.symbol === selectedSymbol;

                return (
                  <tr
                    key={strike}
                    style={{ borderBottom: '1px solid #1a1a24' }}
                    onMouseEnter={e => {
                      const cells = e.currentTarget.querySelectorAll('td');
                      cells.forEach(c => c.style.background = getRowBg(strike, true));
                    }}
                    onMouseLeave={e => {
                      const cells = e.currentTarget.querySelectorAll('td');
                      cells.forEach(c => c.style.background = '');
                    }}
                  >
                    {/* Call side */}
                    <CallPutCells
                      entry={call}
                      type="call"
                      isITM={callITM}
                      isSelected={isCallSelected}
                      cellStyle={cellStyle}
                      side="left"
                      onClick={() => call && onSelectOption?.(call, 'call')}
                    />

                    {/* Strike column */}
                    <td style={{
                      padding: '7px 12px',
                      textAlign: 'center',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      fontWeight: 700,
                      color: isATM ? '#c9a84c' : '#e8e8e8',
                      background: isATM ? 'rgba(201, 168, 76, 0.08)' : undefined,
                      borderLeft: '2px solid #2a2a3a',
                      borderRight: '2px solid #2a2a3a',
                    }}>
                      ${strike.toFixed(strike % 1 === 0 ? 0 : 2)}
                    </td>

                    {/* Put side */}
                    <CallPutCells
                      entry={put}
                      type="put"
                      isITM={putITM}
                      isSelected={isPutSelected}
                      cellStyle={cellStyle}
                      side="right"
                      onClick={() => put && onSelectOption?.(put, 'put')}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CallPutCells({
  entry,
  type,
  isITM,
  isSelected,
  cellStyle,
  side,
  onClick,
}: {
  entry?: OptionChainEntry;
  type: 'call' | 'put';
  isITM: boolean;
  isSelected: boolean;
  cellStyle: React.CSSProperties;
  side: 'left' | 'right';
  onClick: () => void;
}) {
  const itmBg = isITM ? 'rgba(201, 168, 76, 0.04)' : undefined;
  const selectedBorder = isSelected ? `2px solid ${type === 'call' ? '#4ade80' : '#ef4444'}` : undefined;
  const baseStyle: React.CSSProperties = {
    ...cellStyle,
    background: itmBg,
    cursor: entry ? 'pointer' : 'default',
    outline: selectedBorder,
  };

  if (!entry) {
    const emptyCells = side === 'left'
      ? ['—', '—', '—', '—', '—', '—', '—']
      : ['—', '—', '—', '—', '—', '—', '—'];
    return (
      <>
        {emptyCells.map((v, i) => (
          <td key={`${type}-empty-${i}`} style={baseStyle}>{v}</td>
        ))}
      </>
    );
  }

  if (side === 'left') {
    // Calls: Bid Ask Last Vol OI IV Δ
    return (
      <>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.bid)}</td>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.ask)}</td>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.last)}</td>
        <td style={baseStyle} onClick={onClick}>{fmtVol(entry.volume)}</td>
        <td style={baseStyle} onClick={onClick}>{fmtVol(entry.openInterest)}</td>
        <td style={baseStyle} onClick={onClick}>{entry.impliedVolatility > 0 ? `${entry.impliedVolatility.toFixed(0)}%` : '—'}</td>
        <td style={{ ...baseStyle, color: '#4ade80' }} onClick={onClick}>{fmt(Math.abs(entry.delta))}</td>
      </>
    );
  } else {
    // Puts: Δ IV OI Vol Last Ask Bid
    return (
      <>
        <td style={{ ...baseStyle, textAlign: 'left', color: '#ef4444' }} onClick={onClick}>{fmt(Math.abs(entry.delta))}</td>
        <td style={baseStyle} onClick={onClick}>{entry.impliedVolatility > 0 ? `${entry.impliedVolatility.toFixed(0)}%` : '—'}</td>
        <td style={baseStyle} onClick={onClick}>{fmtVol(entry.openInterest)}</td>
        <td style={baseStyle} onClick={onClick}>{fmtVol(entry.volume)}</td>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.last)}</td>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.ask)}</td>
        <td style={baseStyle} onClick={onClick}>{fmt(entry.bid)}</td>
      </>
    );
  }
}

function formatExpLabel(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr + 'T12:00:00');
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
