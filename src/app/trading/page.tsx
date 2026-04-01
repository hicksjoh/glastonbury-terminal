'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { AlertTriangle, TrendingUp, TrendingDown, Search, X } from 'lucide-react';
import TradeGuard from '@/components/TradeGuard';
import PortfolioChart from '@/components/PortfolioChart';
import OptionsChain from '@/components/options/OptionsChain';
import OptionsOrderForm from '@/components/options/OptionsOrderForm';
import type { OrderPreview } from '@/components/options/OptionsOrderForm';
import OrderConfirmation from '@/components/options/OrderConfirmation';
import OptionsPositions from '@/components/options/OptionsPositions';
import GreeksSummary from '@/components/options/GreeksSummary';
import type { OptionChainEntry } from '@/lib/options/types';

interface MockPosition {
  symbol: string;
  qty: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  currentPrice: number;
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  price?: number;
  prevClose?: number;
  change?: string;
}

const MOCK_POSITIONS: MockPosition[] = [
  { symbol: 'AAPL', qty: 10, marketValue: 1870, costBasis: 1700, unrealizedPL: 170, unrealizedPLPercent: 10.0, currentPrice: 187.0 },
  { symbol: 'NVDA', qty: 5, marketValue: 4350, costBasis: 3800, unrealizedPL: 550, unrealizedPLPercent: 14.5, currentPrice: 870.0 },
  { symbol: 'VTI', qty: 20, marketValue: 4940, costBasis: 5100, unrealizedPL: -160, unrealizedPLPercent: -3.1, currentPrice: 247.0 },
  { symbol: 'MSFT', qty: 8, marketValue: 3360, costBasis: 3200, unrealizedPL: 160, unrealizedPLPercent: 5.0, currentPrice: 420.0 },
];

const COLORS = ['#c9a84c', '#22c55e', '#818cf8', '#38bdf8', '#f59e0b'];

interface AccountData {
  equity: string;
  cash: string;
  buying_power: string;
}

interface OrderForm {
  symbol: string;
  side: string;
  qty: string;
  type: string;
  limitPrice: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function TradingPageWrapper() {
  return (
    <Suspense fallback={<AppShell><div style={{ textAlign: 'center', padding: 60, color: '#6b6b80' }}>Loading...</div></AppShell>}>
      <TradingPage />
    </Suspense>
  );
}

function TradingPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'options' ? 'options' : 'stocks';
  const [activeTab, setActiveTab] = useState<'stocks' | 'options'>(initialTab);

  const [positions, setPositions] = useState<MockPosition[]>(MOCK_POSITIONS);
  const [account, setAccount] = useState<AccountData>({ equity: '82000', cash: '18000', buying_power: '36000' });
  const [form, setForm] = useState<OrderForm>({ symbol: '', side: 'buy', qty: '', type: 'market', limitPrice: '' });
  const [step, setStep] = useState<'form' | 'guard' | 'confirm' | 'submitted'>('form');
  const [apiConnected, setApiConnected] = useState(false);

  // Ticker search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 300);

  // Options state
  const [optionsSymbol, setOptionsSymbol] = useState('');
  const [optionsSearchQuery, setOptionsSearchQuery] = useState('');
  const [optionsSearchResults, setOptionsSearchResults] = useState<SearchResult[]>([]);
  const [optionsShowDropdown, setOptionsShowDropdown] = useState(false);
  const [optionsSearching, setOptionsSearching] = useState(false);
  const optionsSearchRef = useRef<HTMLDivElement>(null);
  const debouncedOptionsQuery = useDebounce(optionsSearchQuery, 300);
  const [selectedOption, setSelectedOption] = useState<OptionChainEntry | null>(null);
  const [selectedOptionSide, setSelectedOptionSide] = useState<'call' | 'put'>('call');
  const [confirmOrder, setConfirmOrder] = useState<OrderPreview | null>(null);
  const [optionsPnl, setOptionsPnl] = useState(0);
  const [netTheta, setNetTheta] = useState(0);
  const [positionSubTab, setPositionSubTab] = useState<'all' | 'stocks' | 'options'>('all');

  useEffect(() => {
    fetch('/api/alpaca/account')
      .then(r => r.json())
      .then(data => {
        if (!data.error) {
          setAccount(data);
          setApiConnected(true);
        }
      })
      .catch(() => {});

    fetch('/api/alpaca/positions')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((p: Record<string, string>) => ({
            symbol: p.symbol,
            qty: parseFloat(p.qty),
            marketValue: parseFloat(p.market_value),
            costBasis: parseFloat(p.cost_basis),
            unrealizedPL: parseFloat(p.unrealized_pl),
            unrealizedPLPercent: parseFloat(p.unrealized_plpc) * 100,
            currentPrice: parseFloat(p.current_price),
          }));
          setPositions(mapped);
        }
      })
      .catch(() => {});

    // Fetch options stats
    fetch('/api/options/positions')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.positions?.length > 0) {
          const totalPnl = data.positions.reduce((s: number, p: { pnl: number }) => s + (p.pnl || 0), 0);
          setOptionsPnl(totalPnl);
          if (data.greeks?.netTheta) setNetTheta(data.greeks.netTheta);
        }
      })
      .catch(() => {});
  }, []);

  // Stock ticker search
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    fetch(`/api/alpaca/search?q=${encodeURIComponent(debouncedQuery)}&limit=8`)
      .then(r => r.json())
      .then(data => {
        setSearchResults(data.results || []);
        setShowDropdown(true);
        setSearching(false);
      })
      .catch(() => {
        setSearching(false);
        setShowDropdown(false);
      });
  }, [debouncedQuery]);

  // Options ticker search
  useEffect(() => {
    if (!debouncedOptionsQuery || debouncedOptionsQuery.length < 1) {
      setOptionsSearchResults([]);
      setOptionsShowDropdown(false);
      return;
    }
    setOptionsSearching(true);
    fetch(`/api/alpaca/search?q=${encodeURIComponent(debouncedOptionsQuery)}&limit=8`)
      .then(r => r.json())
      .then(data => {
        setOptionsSearchResults(data.results || []);
        setOptionsShowDropdown(true);
        setOptionsSearching(false);
      })
      .catch(() => {
        setOptionsSearching(false);
        setOptionsShowDropdown(false);
      });
  }, [debouncedOptionsQuery]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (optionsSearchRef.current && !optionsSearchRef.current.contains(e.target as Node)) {
        setOptionsShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Update URL when tab changes
  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeTab === 'options') {
      url.searchParams.set('tab', 'options');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.replaceState({}, '', url.toString());
  }, [activeTab]);

  const fetchPrice = useCallback(async (symbol: string) => {
    setPriceLoading(true);
    setSelectedPrice(null);
    try {
      const res = await fetch(`/api/alpaca/market-data?symbol=${symbol}`);
      const data = await res.json();
      if (data.quote) {
        const ask = data.quote.ap || 0;
        const bid = data.quote.bp || 0;
        setSelectedPrice(ask > 0 ? (ask + bid) / 2 : null);
      }
    } catch {
      // Price not available
    }
    setPriceLoading(false);
  }, []);

  function selectTicker(result: SearchResult) {
    setForm(p => ({ ...p, symbol: result.symbol }));
    setSearchQuery(result.symbol);
    setShowDropdown(false);
    if (result.price) {
      setSelectedPrice(result.price);
    } else {
      fetchPrice(result.symbol);
    }
  }

  function selectOptionsTicker(result: SearchResult) {
    setOptionsSymbol(result.symbol);
    setOptionsSearchQuery(result.symbol);
    setOptionsShowDropdown(false);
    setSelectedOption(null);
  }

  async function submitOrder() {
    const order = {
      symbol: form.symbol.toUpperCase(),
      qty: parseInt(form.qty),
      side: form.side,
      type: form.type,
      time_in_force: 'day',
      ...(form.type === 'limit' ? { limit_price: parseFloat(form.limitPrice) } : {}),
    };
    try {
      await fetch('/api/alpaca/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
    } catch {
      // Silently handle — still show submitted state for paper demo
    }
    setStep('submitted');
    setForm({ symbol: '', side: 'buy', qty: '', type: 'market', limitPrice: '' });
    setSearchQuery('');
    setSelectedPrice(null);
  }

  function handleSelectOption(entry: OptionChainEntry, side: 'call' | 'put') {
    setSelectedOption(entry);
    setSelectedOptionSide(side);
  }

  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const pieData = positions.map(p => ({ name: p.symbol, value: p.marketValue }));

  const safeParseFloat = (val: string) => {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  };

  const estimatedTotal = selectedPrice && form.qty ? (selectedPrice * parseInt(form.qty || '0')).toFixed(2) : null;

  return (
    <AppShell>
      {/* Paper Trading Warning Banner */}
      <div style={{
        backgroundColor: '#f59e0b10',
        border: '1px solid #f59e0b40',
        borderRadius: 8,
        padding: '10px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <AlertTriangle size={16} color="#f59e0b" />
        <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
          PAPER TRADING MODE &mdash; No real money. All trades are simulated.
        </span>
        {!apiConnected && (
          <span style={{ fontSize: 12, color: '#6b6b80', marginLeft: 'auto' }}>
            Using demo data. Configure ALPACA_API_KEY to connect live paper account.
          </span>
        )}
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #2a2a3a' }}>
        {(['stocks', 'options'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 28px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #c9a84c' : '2px solid transparent',
              color: activeTab === tab ? '#c9a84c' : '#6b6b80',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: -2,
              transition: 'all 0.2s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Account Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
        {[
          { label: 'Portfolio Equity', value: `$${safeParseFloat(account.equity).toLocaleString()}` },
          { label: 'Cash Available', value: `$${safeParseFloat(account.cash).toLocaleString()}` },
          { label: 'Buying Power', value: `$${safeParseFloat(account.buying_power).toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="terminal-card">
            <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#c9a84c' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Options Stats Cards — shown only on options tab */}
      {activeTab === 'options' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
          <div className="terminal-card">
            <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>Options P&amp;L</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: optionsPnl >= 0 ? '#22c55e' : '#ef4444' }}>
              {optionsPnl !== 0 ? `${optionsPnl >= 0 ? '+' : ''}$${Math.abs(Math.round(optionsPnl)).toLocaleString()}` : '—'}
            </div>
          </div>
          <div className="terminal-card">
            <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>Net Theta</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: netTheta >= 0 ? '#22c55e' : '#ef4444' }}>
              {netTheta !== 0 ? `$${Number(netTheta).toFixed(0)}/day` : '—'}
            </div>
          </div>
          <div className="terminal-card">
            <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>Monthly Theta</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#c9a84c' }}>
              {netTheta !== 0 ? `$${(Number(netTheta) * 30).toFixed(0)}` : '—'}
            </div>
          </div>
          <div className="terminal-card" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/trading/options/screener'}>
            <div style={{ fontSize: 12, color: '#6b6b80', marginBottom: 4 }}>Tools</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c', marginTop: 8 }}>
              Screener &rarr;
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
              Strategy Builder &rarr;
            </div>
          </div>
        </div>
      )}

      {/* ========== STOCKS TAB ========== */}
      {activeTab === 'stocks' && (
        <>
          <PortfolioChart />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            {/* Stock Order Form */}
            <div className="terminal-card">
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20 }}>
                {step === 'submitted' ? 'Order Submitted' : step === 'confirm' ? 'Confirm Order' : step === 'guard' ? 'Keisha Guard Check' : 'Place Order'}
              </div>

              {step === 'form' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Symbol Search with Autocomplete */}
                  <div ref={searchRef} style={{ position: 'relative' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      backgroundColor: '#08080d',
                      border: showDropdown ? '1px solid #c9a84c' : '1px solid #2a2a3a',
                      borderRadius: 8,
                      padding: '0 12px',
                      transition: 'border-color 0.2s',
                    }}>
                      <Search size={14} color={showDropdown ? '#c9a84c' : '#6b6b80'} />
                      <input
                        value={searchQuery}
                        onChange={e => {
                          const val = e.target.value.toUpperCase();
                          setSearchQuery(val);
                          setForm(p => ({ ...p, symbol: val }));
                          if (!val) {
                            setSelectedPrice(null);
                            setShowDropdown(false);
                          }
                        }}
                        onFocus={() => {
                          if (searchResults.length > 0) setShowDropdown(true);
                        }}
                        placeholder="Search ticker or company name..."
                        style={{
                          flex: 1,
                          padding: '10px 8px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: '#e8e8e8',
                          fontSize: 14,
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                      {searching && (
                        <div style={{ color: '#6b6b80', fontSize: 11 }}>searching...</div>
                      )}
                      {searchQuery && !searching && (
                        <X
                          size={14}
                          color="#6b6b80"
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            setSearchQuery('');
                            setForm(p => ({ ...p, symbol: '' }));
                            setSelectedPrice(null);
                            setSearchResults([]);
                            setShowDropdown(false);
                          }}
                        />
                      )}
                    </div>

                    {/* Search Dropdown */}
                    {showDropdown && searchResults.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        backgroundColor: '#12121a',
                        border: '1px solid #2a2a3a',
                        borderRadius: 8,
                        maxHeight: 320,
                        overflowY: 'auto',
                        zIndex: 50,
                        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                      }}>
                        {searchResults.map((r, i) => (
                          <div
                            key={r.symbol}
                            onClick={() => selectTicker(r)}
                            style={{
                              padding: '10px 14px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              borderBottom: i < searchResults.length - 1 ? '1px solid #1a1a24' : 'none',
                              transition: 'background-color 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1a1a2e')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, color: '#c9a84c', fontSize: 14 }}>{r.symbol}</span>
                                <span style={{
                                  fontSize: 10,
                                  color: '#6b6b80',
                                  backgroundColor: '#2a2a3a',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                }}>{r.exchange}</span>
                              </div>
                              <div style={{ fontSize: 12, color: '#6b6b80', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.name}
                              </div>
                            </div>
                            {r.price && (
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8' }}>
                                  ${r.price.toFixed(2)}
                                </div>
                                {r.change && (
                                  <div style={{
                                    fontSize: 11,
                                    color: parseFloat(r.change) >= 0 ? '#22c55e' : '#ef4444',
                                  }}>
                                    {parseFloat(r.change) >= 0 ? '+' : ''}{r.change}%
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {showDropdown && searchResults.length === 0 && !searching && debouncedQuery.length >= 1 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        backgroundColor: '#12121a',
                        border: '1px solid #2a2a3a',
                        borderRadius: 8,
                        padding: '16px',
                        textAlign: 'center',
                        color: '#6b6b80',
                        fontSize: 13,
                        zIndex: 50,
                      }}>
                        No matches found for &ldquo;{debouncedQuery}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* Price Preview */}
                  {form.symbol && (selectedPrice || priceLoading) && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: '#c9a84c08',
                      border: '1px solid #c9a84c20',
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}>
                      <span style={{ fontSize: 12, color: '#6b6b80' }}>
                        {form.symbol} current price
                      </span>
                      {priceLoading ? (
                        <span style={{ fontSize: 12, color: '#6b6b80' }}>Loading...</span>
                      ) : (
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#c9a84c' }}>
                          ${selectedPrice?.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Buy / Sell toggle */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['buy', 'sell'].map(side => (
                      <button
                        key={side}
                        onClick={() => setForm(p => ({ ...p, side }))}
                        style={{
                          flex: 1,
                          padding: '10px 0',
                          borderRadius: 8,
                          border: 'none',
                          cursor: 'pointer',
                          backgroundColor: form.side === side
                            ? side === 'buy' ? '#22c55e' : '#ef4444'
                            : '#2a2a3a',
                          color: form.side === side ? '#fff' : '#6b6b80',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          fontSize: 13,
                        }}
                      >{side}</button>
                    ))}
                  </div>
                  <input
                    value={form.qty}
                    onChange={e => setForm(p => ({ ...p, qty: e.target.value }))}
                    placeholder="Quantity"
                    type="number"
                    style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 14, outline: 'none' }}
                  />

                  {/* Estimated Total */}
                  {estimatedTotal && parseInt(form.qty) > 0 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      fontSize: 12,
                      color: '#6b6b80',
                    }}>
                      <span>Estimated total</span>
                      <span style={{ color: '#e8e8e8', fontWeight: 600 }}>${parseFloat(estimatedTotal).toLocaleString()}</span>
                    </div>
                  )}

                  {/* Order type toggle */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['market', 'limit'].map(t => (
                      <button
                        key={t}
                        onClick={() => setForm(p => ({ ...p, type: t }))}
                        style={{
                          flex: 1,
                          padding: '8px 0',
                          borderRadius: 8,
                          border: 'none',
                          cursor: 'pointer',
                          backgroundColor: form.type === t ? '#c9a84c20' : '#2a2a3a',
                          color: form.type === t ? '#c9a84c' : '#6b6b80',
                          fontWeight: 600,
                          fontSize: 13,
                          textTransform: 'capitalize',
                        }}
                      >{t}</button>
                    ))}
                  </div>
                  {form.type === 'limit' && (
                    <input
                      value={form.limitPrice}
                      onChange={e => setForm(p => ({ ...p, limitPrice: e.target.value }))}
                      placeholder="Limit Price"
                      type="number"
                      style={{ padding: '10px 12px', backgroundColor: '#08080d', border: '1px solid #2a2a3a', borderRadius: 8, color: '#e8e8e8', fontSize: 14, outline: 'none' }}
                    />
                  )}
                  <button
                    onClick={() => setStep('guard')}
                    disabled={!form.symbol || !form.qty}
                    style={{
                      padding: '12px 0',
                      backgroundColor: form.side === 'buy' ? '#22c55e' : '#ef4444',
                      border: 'none',
                      borderRadius: 8,
                      color: '#fff',
                      fontWeight: 700,
                      cursor: !form.symbol || !form.qty ? 'not-allowed' : 'pointer',
                      fontSize: 15,
                      opacity: !form.symbol || !form.qty ? 0.5 : 1,
                    }}
                  >
                    Review Order
                  </button>
                </div>
              )}

              {step === 'guard' && form.symbol && (
                <TradeGuard
                  symbol={form.symbol}
                  side={form.side as 'buy' | 'sell'}
                  quantity={parseInt(form.qty) || 0}
                  price={selectedPrice || 0}
                  onProceed={() => setStep('confirm')}
                  onCancel={() => setStep('form')}
                  onAdjustSize={(newQty) => {
                    setForm(p => ({ ...p, qty: String(newQty) }));
                    setStep('form');
                  }}
                />
              )}

              {step === 'confirm' && (
                <div>
                  <div style={{ backgroundColor: '#08080d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    {[
                      { label: 'Symbol', value: form.symbol, color: '#c9a84c' },
                      { label: 'Side', value: form.side.toUpperCase(), color: form.side === 'buy' ? '#22c55e' : '#ef4444' },
                      { label: 'Quantity', value: `${form.qty} shares`, color: '#e8e8e8' },
                      { label: 'Type', value: `${form.type}${form.limitPrice ? ` @ $${form.limitPrice}` : ''}`, color: '#e8e8e8' },
                      ...(estimatedTotal ? [{ label: 'Est. Total', value: `$${parseFloat(estimatedTotal).toLocaleString()}`, color: '#c9a84c' }] : []),
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ color: '#6b6b80' }}>{label}</span>
                        <span style={{ fontWeight: 700, color, textTransform: 'capitalize' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setStep('form')}
                      style={{ flex: 1, padding: '10px 0', backgroundColor: '#2a2a3a', border: 'none', borderRadius: 8, color: '#e8e8e8', cursor: 'pointer', fontWeight: 600 }}
                    >Back</button>
                    <button
                      onClick={submitOrder}
                      style={{
                        flex: 2,
                        padding: '10px 0',
                        backgroundColor: form.side === 'buy' ? '#22c55e' : '#ef4444',
                        border: 'none',
                        borderRadius: 8,
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >Confirm {form.side.toUpperCase()}</button>
                  </div>
                </div>
              )}

              {step === 'submitted' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12, color: '#22c55e' }}>&#10003;</div>
                  <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 8 }}>Order submitted (paper trade)</div>
                  <div style={{ color: '#6b6b80', fontSize: 12, marginBottom: 20 }}>Simulated execution in paper account</div>
                  <button
                    onClick={() => setStep('form')}
                    style={{ padding: '10px 24px', backgroundColor: '#c9a84c', border: 'none', borderRadius: 8, color: '#08080d', cursor: 'pointer', fontWeight: 700 }}
                  >New Order</button>
                </div>
              )}
            </div>

            {/* Allocation Pie */}
            <div className="terminal-card">
              <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Portfolio Allocation
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [`$${v.toLocaleString()}`]}
                    contentStyle={{ backgroundColor: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {positions.map((p, i) => (
                  <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: COLORS[i % COLORS.length] }} />
                    <span style={{ fontSize: 12, color: '#6b6b80' }}>
                      {p.symbol} {((p.marketValue / totalMarketValue) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========== OPTIONS TAB ========== */}
      {activeTab === 'options' && (
        <>
          {/* Options Ticker Search */}
          <div style={{ marginBottom: 20 }}>
            <div ref={optionsSearchRef} style={{ position: 'relative', maxWidth: 500 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#08080d',
                border: optionsShowDropdown ? '1px solid #c9a84c' : '1px solid #2a2a3a',
                borderRadius: 8,
                padding: '0 12px',
                transition: 'border-color 0.2s',
              }}>
                <Search size={14} color={optionsShowDropdown ? '#c9a84c' : '#6b6b80'} />
                <input
                  value={optionsSearchQuery}
                  onChange={e => {
                    const val = e.target.value.toUpperCase();
                    setOptionsSearchQuery(val);
                  }}
                  onFocus={() => {
                    if (optionsSearchResults.length > 0) setOptionsShowDropdown(true);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && optionsSearchQuery) {
                      setOptionsSymbol(optionsSearchQuery);
                      setOptionsShowDropdown(false);
                      setSelectedOption(null);
                    }
                  }}
                  placeholder="Search symbol for options chain..."
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#e8e8e8',
                    fontSize: 15,
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                {optionsSearching && (
                  <div style={{ color: '#6b6b80', fontSize: 11 }}>searching...</div>
                )}
                {optionsSearchQuery && !optionsSearching && (
                  <X
                    size={14}
                    color="#6b6b80"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setOptionsSearchQuery('');
                      setOptionsSymbol('');
                      setOptionsSearchResults([]);
                      setOptionsShowDropdown(false);
                      setSelectedOption(null);
                    }}
                  />
                )}
              </div>

              {optionsShowDropdown && optionsSearchResults.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  backgroundColor: '#12121a',
                  border: '1px solid #2a2a3a',
                  borderRadius: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                  zIndex: 50,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                }}>
                  {optionsSearchResults.map((r, i) => (
                    <div
                      key={r.symbol}
                      onClick={() => selectOptionsTicker(r)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: i < optionsSearchResults.length - 1 ? '1px solid #1a1a24' : 'none',
                        transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1a1a2e')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div>
                        <span style={{ fontWeight: 700, color: '#c9a84c', fontSize: 14 }}>{r.symbol}</span>
                        <span style={{ fontSize: 12, color: '#6b6b80', marginLeft: 10 }}>{r.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Options Chain + Order Form */}
          {optionsSymbol ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 24 }}>
              <div className="terminal-card" style={{ padding: 16, overflow: 'hidden' }}>
                <OptionsChain
                  symbol={optionsSymbol}
                  onSelectOption={handleSelectOption}
                  selectedSymbol={selectedOption?.symbol}
                />
              </div>
              <OptionsOrderForm
                selectedOption={selectedOption}
                selectedSide={selectedOptionSide}
                onShowConfirmation={setConfirmOrder}
                onOrderSubmitted={() => {
                  setSelectedOption(null);
                  setConfirmOrder(null);
                }}
              />
            </div>
          ) : (
            <div className="terminal-card" style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>⛓</div>
              <div style={{ color: '#6b6b80', fontSize: 14 }}>
                Search for a symbol above to view its options chain
              </div>
              <div style={{ color: '#555', fontSize: 12, marginTop: 8 }}>
                Try AAPL, NVDA, MSFT, TSLA, or SPY
              </div>
            </div>
          )}
        </>
      )}

      {/* Positions Section with Sub-Tabs */}
      <div className="terminal-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Positions</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'stocks', 'options'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPositionSubTab(tab)}
                style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none',
                  backgroundColor: positionSubTab === tab ? '#c9a84c20' : 'transparent',
                  color: positionSubTab === tab ? '#c9a84c' : '#6b6b80',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                }}
              >{tab}</button>
            ))}
          </div>
        </div>

        {/* Stock Positions Table */}
        {(positionSubTab === 'all' || positionSubTab === 'stocks') && (
          <div style={{ overflowX: 'auto', marginBottom: positionSubTab === 'all' ? 20 : 0 }}>
            {positionSubTab === 'all' && (
              <div style={{ fontSize: 11, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stock Positions</div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                  {['Symbol', 'Qty', 'Current Price', 'Market Value', 'P&L', 'P&L %'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '8px 12px',
                      fontSize: 11,
                      color: '#6b6b80',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <tr key={pos.symbol} style={{ borderBottom: '1px solid #1a1a24' }}>
                    <td style={{ padding: '12px 12px', fontSize: 14, fontWeight: 700, color: '#c9a84c', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => window.location.href = `/stock/${pos.symbol}`}>{pos.symbol}</td>
                    <td style={{ padding: '12px 12px', fontSize: 14 }}>{pos.qty}</td>
                    <td style={{ padding: '12px 12px', fontSize: 14 }}>${pos.currentPrice.toFixed(2)}</td>
                    <td style={{ padding: '12px 12px', fontSize: 14 }}>${pos.marketValue.toLocaleString()}</td>
                    <td style={{ padding: '12px 12px', fontSize: 14, color: pos.unrealizedPL >= 0 ? '#22c55e' : '#ef4444' }}>
                      {pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 14, color: pos.unrealizedPLPercent >= 0 ? '#22c55e' : '#ef4444' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {pos.unrealizedPLPercent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {pos.unrealizedPLPercent >= 0 ? '+' : ''}{pos.unrealizedPLPercent.toFixed(1)}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Options Positions */}
        {(positionSubTab === 'all' || positionSubTab === 'options') && (
          <div>
            {positionSubTab === 'all' && (
              <div style={{ fontSize: 11, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid #2a2a3a', paddingTop: 16 }}>Options Positions</div>
            )}
            <OptionsPositions />
          </div>
        )}
      </div>

      {/* Greeks Summary — shown on options tab */}
      {activeTab === 'options' && (
        <div style={{ marginTop: 20 }}>
          <GreeksSummary />
        </div>
      )}

      {/* Order Confirmation Modal */}
      {confirmOrder && (
        <OrderConfirmation
          order={confirmOrder}
          onConfirm={() => {
            setConfirmOrder(null);
            setSelectedOption(null);
          }}
          onCancel={() => setConfirmOrder(null)}
        />
      )}
    </AppShell>
  );
}
