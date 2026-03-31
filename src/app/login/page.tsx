'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
    } else {
      setError('Invalid access code');
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#08080d' }}>
      <div style={{ width: 360, border: '1px solid #2a2a3a', borderRadius: 16, padding: '48px 40px', backgroundColor: '#1a1a24', textAlign: 'center' }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
          <Image
            src="/glastonbury-logo.png"
            alt="Glastonbury Group"
            width={120}
            height={120}
            className="filter invert brightness-[1.8]"
            priority
          />
        </div>
        <div style={{ color: '#e8e8e8', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Glastonbury Terminal</div>
        <div style={{ color: '#6b6b80', fontSize: 13, marginBottom: 36 }}>Enter your access code to continue</div>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Access code"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: '#08080d',
              border: '1px solid #2a2a3a',
              borderRadius: 8,
              color: '#e8e8e8',
              fontSize: 15,
              marginBottom: 12,
              outline: 'none',
              letterSpacing: '0.1em',
            }}
          />
          {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              padding: '12px 0',
              backgroundColor: '#c9a84c',
              color: '#08080d',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 700,
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              opacity: loading || !password ? 0.6 : 1,
            }}
          >
            {loading ? 'Authenticating...' : 'Access Terminal'}
          </button>
        </form>
        <div style={{ marginTop: 24, color: '#6b6b80', fontSize: 11 }}>THE GLASTONBURY GROUP &bull; PRIVATE</div>
      </div>
    </div>
  );
}
