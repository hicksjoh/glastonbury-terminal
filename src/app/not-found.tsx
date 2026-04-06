export default function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#08080d', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 72, fontWeight: 800, color: '#8a5cf6', marginBottom: 8 }}>404</div>
      <h2 style={{ fontSize: 20, color: '#fff', marginBottom: 8 }}>Page not found</h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <a href="/" style={{
        padding: '12px 32px', borderRadius: 10, textDecoration: 'none',
        background: '#8a5cf6', color: '#fff', fontSize: 14, fontWeight: 700,
      }}>
        Go to Dashboard
      </a>
    </div>
  );
}
