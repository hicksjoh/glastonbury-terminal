'use client';

// Top-of-app indicator for paper vs live trading. Defaults to "paper" so the
// banner never silently implies real-money mode on a misconfigured build.
// Set NEXT_PUBLIC_TRADING_MODE=live to flip to the amber real-money banner.

const MODE = (process.env.NEXT_PUBLIC_TRADING_MODE || 'paper').toLowerCase();
const IS_LIVE = MODE === 'live';

export function TradingModeBanner() {
  const bg = IS_LIVE ? 'rgba(234, 88, 12, 0.95)' : 'rgba(16, 185, 129, 0.95)';
  const border = IS_LIVE ? 'rgba(251, 146, 60, 0.6)' : 'rgba(74, 222, 128, 0.4)';
  const label = IS_LIVE ? 'LIVE MODE — REAL MONEY' : 'PAPER MODE — SIMULATED FUNDS';

  return (
    <div
      role="status"
      aria-label={label}
      style={{
        height: 24,
        background: bg,
        borderBottom: `1px solid ${border}`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {IS_LIVE && (
        <span
          aria-hidden="true"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#fff', animation: 'livePulse 1.2s ease-in-out infinite',
          }}
        />
      )}
      <span>{label}</span>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

export default TradingModeBanner;
