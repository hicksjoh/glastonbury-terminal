'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#08080d', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24, maxWidth: 500 }}>
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button onClick={reset} style={{
        padding: '12px 32px', borderRadius: 10, cursor: 'pointer',
        background: '#8a5cf6', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700,
      }}>
        Try Again
      </button>
    </div>
  );
}
