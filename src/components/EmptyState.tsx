'use client';

/**
 * EmptyState — consistent empty/no-data display for terminal pages.
 */
export function EmptyState({
  icon = '📭',
  title = 'No data yet',
  message,
  action,
}: {
  icon?: string;
  title?: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        background: 'var(--secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <span style={{ fontSize: 40, marginBottom: 12, opacity: 0.7 }}>{icon}</span>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px 0' }}>
        {title}
      </h3>
      {message && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px 0', maxWidth: 320 }}>
          {message}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            cursor: 'pointer',
            background: 'var(--gold-dim)',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gold)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gold-dim)')}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
