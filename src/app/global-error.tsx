'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ background: '#08080d', color: '#e8e8e8', fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Glastonbury Terminal</h1>
          <p style={{ color: '#6b6b80', marginTop: 8, fontSize: 16 }}>Something went critically wrong</p>
          <p style={{ color: '#555', fontSize: 13, maxWidth: 400, margin: '12px auto' }}>
            {error.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20, padding: '12px 28px', borderRadius: 10, border: 'none',
              background: '#8a5cf6', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
          <a
            href="/"
            style={{ marginTop: 12, color: '#8a5cf6', fontSize: 13, textDecoration: 'underline' }}
          >
            Go to Dashboard
          </a>
        </div>
      </body>
    </html>
  );
}
