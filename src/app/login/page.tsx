'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { safeNextPath } from '@/lib/safe-next-path';
import { Armillary, ARMILLARY_ENABLED } from '@/components/armillary/Armillary';
import type { ArmillaryBody } from '@/components/armillary/Armillary';

// Plain orbs in the Terminal's own colors. The login page shows no data.
const LOGIN_ORBS: ArmillaryBody[] = [
  { id: 'o1', color: '#C9A84C', weight: 0.55 },
  { id: 'o2', color: '#D8DCE6', weight: 0.35 },
  { id: 'o3', color: '#FF9450', weight: 0.45 },
  { id: 'o4', color: '#8FA3BF', weight: 0.3 },
  { id: 'o5', color: '#EDEBE4', weight: 0.25 },
  { id: 'o6', color: '#C9A84C', weight: 0.4 },
];

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams?.get('next') ?? null);

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
      // Hard navigation, not router.push.
      //
      // The OAuth bounce sends us back to /api/oauth/authorize?... — a Route
      // Handler, not a page. router.push() treats it as an App Router client
      // navigation, fetches it for an RSC payload, gets a 303 to an HTML
      // consent page instead, and only then falls back to a document load.
      // That detour re-runs authorize and is a needless source of flake in
      // the most fragile part of the connector flow. A full document load is
      // what we want after login anyway — it picks up the fresh session
      // cookie cleanly for every `next` target, page or route handler.
      window.location.assign(nextPath);
      return;
    } else {
      setError('Invalid access code');
    }
    setLoading(false);
  }

  return (
    <div className="login-root" style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', backgroundColor: '#06070d' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .login-root { display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box; }
        .login-card { position: relative; z-index: 1; width: min(360px, 100%); box-sizing: border-box; }
        @media (min-width: 900px) { .login-root { justify-content: flex-start; padding-left: 9vw; } }
        @media (max-width: 699px) { .login-root { align-items: flex-end; padding-bottom: 32px; } .login-card { padding: 32px 28px !important; } }
      ` }} />
      {ARMILLARY_ENABLED && (
        <Armillary
          decorative
          bodies={LOGIN_ORBS}
          zoom={1.05}
          shift={{ minWidth: 900, value: 0.17 }}
          lift={{ maxWidth: 700, value: 0.24 }}
          style={{ position: 'absolute', inset: 0, background: '#06070d' }}
        />
      )}
      <div className="login-card" style={{
        border: '1px solid rgba(201, 168, 76, 0.18)', borderRadius: 16, padding: '48px 40px', textAlign: 'center',
        backgroundColor: 'rgba(18, 18, 26, 0.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
      }}>
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
