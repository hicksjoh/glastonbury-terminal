'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next-path';
import { Armillary, ARMILLARY_ENABLED } from '@/components/armillary/Armillary';
import type { ArmillaryBody } from '@/components/armillary/Armillary';
import { getMarketPhase } from '@/components/MarketStatusChip';
import { LogoHero, LOGO_HERO_ENABLED } from '@/components/brand/LogoHero';

// Plain orbs in the Terminal's own colors. The login page shows no data.
const LOGIN_ORBS: ArmillaryBody[] = [
  { id: 'o1', color: '#C9A84C', weight: 0.55 },
  { id: 'o2', color: '#D8DCE6', weight: 0.35 },
  { id: 'o3', color: '#FF9450', weight: 0.45 },
  { id: 'o4', color: '#8FA3BF', weight: 0.3 },
  { id: 'o5', color: '#EDEBE4', weight: 0.25 },
  { id: 'o6', color: '#C9A84C', weight: 0.4 },
];

// The instrument is set to Miami, like the dashboard's.
const LATITUDE = 25.76;
const COORDS = '25.76° N · 80.19° W';
const PHASE: Record<ReturnType<typeof getMarketPhase>, { label: string; tone: string }> = {
  open:   { label: 'Market Open',   tone: '#4ADE80' },
  pre:    { label: 'Pre-Market',    tone: '#F0C674' },
  after:  { label: 'After Hours',   tone: '#F0C674' },
  closed: { label: 'Market Closed', tone: '#5A5A64' },
};

function refusal(status: number): string {
  if (status === 429) return 'Too many tries. Wait a few minutes, then try again.';
  if (status === 401 || status === 400 || status === 413) return 'That access code didn’t work. Check it and try again.';
  return 'Sign-in is unavailable right now. Try again in a minute.';
}

// Layout: an instrument plate beside the armillary. Wide screens put the plate
// on the left and the sphere on the right; phones raise the sphere above it.
const CSS = `
.lg-root { position: relative; min-height: 100vh; min-height: 100dvh; overflow: hidden; background: #06070d; color: #EDEBE4;
  display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  padding: 24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px));
  font-family: var(--font-sans), Inter, system-ui, sans-serif; }
.lg-shade { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(0deg, rgba(6,7,13,.92) 0%, rgba(6,7,13,.45) 48%, rgba(6,7,13,0) 70%); }
.lg-panel { position: relative; z-index: 1; width: min(400px, 100%); box-sizing: border-box; padding: 34px 32px 22px;
  border: 1px solid rgba(201,168,76,.22); border-radius: 18px;
  background: linear-gradient(180deg, rgba(22,24,42,.72), rgba(10,11,22,.82));
  -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: 0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05);
  animation: lg-rise .9s cubic-bezier(.16,1,.3,1) .1s both; transition: border-color .6s, box-shadow .6s; }
.lg-panel::before { content: ""; position: absolute; left: 28px; right: 28px; top: -1px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(217,184,92,.85), transparent); }
.lg-panel.granted { border-color: rgba(217,184,92,.7); box-shadow: 0 30px 80px rgba(0,0,0,.5), 0 0 60px rgba(201,168,76,.18); }
.lg-tick { position: absolute; width: 9px; height: 9px; border: 0 solid rgba(201,168,76,.55); pointer-events: none; }
.lg-tick.tl { top: 10px; left: 10px; border-top-width: 1px; border-left-width: 1px; }
.lg-tick.tr { top: 10px; right: 10px; border-top-width: 1px; border-right-width: 1px; }
.lg-tick.bl { bottom: 10px; left: 10px; border-bottom-width: 1px; border-left-width: 1px; }
.lg-tick.br { bottom: 10px; right: 10px; border-bottom-width: 1px; border-right-width: 1px; }
.lg-logo { display: block; margin: -6px -10px 6px; }
.lg-eyebrow { font: 500 10.5px/1 var(--font-mono), "JetBrains Mono", Menlo, monospace; letter-spacing: .3em; text-transform: uppercase; color: #C9A84C; }
.lg-title { margin: 16px 0 10px; font-family: var(--font-serif), Fraunces, Georgia, serif; font-weight: 400;
  font-size: clamp(36px, 4.4vw, 46px); line-height: 1.02; letter-spacing: -.01em; color: #EDEBE4; }
.lg-title em { font-style: italic; color: #D9B85C; }
.lg-sub { margin: 0; font-size: 14px; line-height: 1.5; color: #8A8A96; }
.lg-form { margin-top: 26px; display: grid; gap: 10px; }
.lg-label { font: 500 10.5px/1 var(--font-mono), "JetBrains Mono", Menlo, monospace; letter-spacing: .22em; text-transform: uppercase; color: #8A8A96; }
.lg-input { width: 100%; box-sizing: border-box; padding: 14px 16px; border-radius: 10px; border: 1px solid #2A2A34;
  background: rgba(6,7,13,.65); color: #EDEBE4; outline: none; font: 500 16px/1.2 var(--font-mono), "JetBrains Mono", Menlo, monospace;
  letter-spacing: .28em; transition: border-color .2s, box-shadow .2s; }
.lg-input::placeholder { color: #3D3D48; letter-spacing: .28em; }
.lg-input:focus { border-color: rgba(217,184,92,.75); box-shadow: 0 0 0 3px rgba(201,168,76,.16); }
.lg-input[aria-invalid="true"] { border-color: rgba(248,113,113,.7); }
.lg-input[aria-invalid="true"]:focus { box-shadow: 0 0 0 3px rgba(248,113,113,.14); }
.lg-shake { animation: lg-shake .38s ease; }
.lg-msg { min-height: 18px; margin: 0; font-size: 13px; line-height: 1.4; color: #F87171; }
.lg-go { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 14px 18px; margin-top: 2px;
  border: 0; border-radius: 10px; cursor: pointer; color: #15110a; font: 600 14.5px/1 var(--font-sans), Inter, system-ui, sans-serif; letter-spacing: .02em;
  background: linear-gradient(180deg, #DDBD62 0%, #C9A84C 55%, #B3923C 100%);
  box-shadow: 0 10px 30px rgba(201,168,76,.18), inset 0 1px 0 rgba(255,255,255,.35); transition: filter .2s, opacity .2s, transform .1s; }
.lg-go:hover:not(:disabled) { filter: brightness(1.06); }
.lg-go:active:not(:disabled) { transform: translateY(1px); }
.lg-go:disabled { opacity: .55; cursor: not-allowed; }
.lg-go:focus-visible { outline: 2px solid #D9B85C; outline-offset: 3px; }
.lg-go .arrow { transition: transform .2s; }
.lg-go:hover:not(:disabled) .arrow { transform: translateX(3px); }
.lg-readout { margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.07); display: flex; flex-wrap: wrap; gap: 6px 14px;
  font: 500 10.5px/1.4 var(--font-mono), "JetBrains Mono", Menlo, monospace; letter-spacing: .1em; text-transform: uppercase; color: #8A8A96;
  font-variant-numeric: tabular-nums; }
.lg-readout b { color: #EDEBE4; font-weight: 500; }
.lg-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
.lg-foot { margin-top: 12px; font: 500 9.5px/1 var(--font-mono), "JetBrains Mono", Menlo, monospace; letter-spacing: .26em; text-transform: uppercase; color: #5A5A64; }
@keyframes lg-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes lg-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
@media (min-width: 900px) {
  .lg-root { justify-content: flex-start; padding-left: 9vw; }
  .lg-shade { background: linear-gradient(90deg, rgba(6,7,13,.8) 0%, rgba(6,7,13,.38) 36%, rgba(6,7,13,0) 58%); }
  .lg-panel { padding: 42px 40px 26px; }
}
@media (max-width: 699px) { .lg-root { align-items: flex-end; padding-bottom: max(24px, env(safe-area-inset-bottom, 0px)); } }
@media (prefers-reduced-motion: reduce) { .lg-panel, .lg-shake { animation: none; } .lg-panel, .lg-input, .lg-go, .lg-go .arrow { transition: none; } }
`;

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'granted'>('idle');
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams?.get('next') ?? null);

  // Clock-driven readout, filled in after mount so server and client render alike.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const etTime = now
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(now) + ' ET'
    : '—:— ET';
  const phase = now ? PHASE[getMarketPhase(now)] : null;

  function refuse(message: string) {
    setError(message);
    setState('idle');
    setShake(true);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || state !== 'idle') return;
    setState('checking');
    setError('');
    let res: Response;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    } catch {
      refuse('Couldn’t reach the Terminal. Check your connection and try again.');
      return;
    }
    if (res.ok) {
      setState('granted');
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
    }
    refuse(refusal(res.status));
  }

  const invalid = !!error;
  return (
    <main className="lg-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {ARMILLARY_ENABLED && (
        <Armillary
          decorative
          bodies={LOGIN_ORBS}
          latitude={LATITUDE}
          zoom={1.05}
          shift={{ minWidth: 900, value: 0.17 }}
          lift={{ maxWidth: 700, value: 0.24 }}
          style={{ position: 'absolute', inset: 0, background: '#06070d' }}
        />
      )}
      <div className="lg-shade" aria-hidden="true" />

      <section className={`lg-panel${state === 'granted' ? ' granted' : ''}`} aria-labelledby="lg-title" data-testid="login-panel">
        <span className="lg-tick tl" aria-hidden="true" />
        <span className="lg-tick tr" aria-hidden="true" />
        <span className="lg-tick bl" aria-hidden="true" />
        <span className="lg-tick br" aria-hidden="true" />

        {LOGO_HERO_ENABLED
          ? <LogoHero className="lg-logo" />
          : <div className="lg-eyebrow">The Glastonbury Group</div>}
        <h1 id="lg-title" className="lg-title">Glastonbury <em>Terminal</em></h1>
        <p className="lg-sub">Private wealth command center.</p>

        <form className="lg-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="lg-code" className="lg-label">Access code</label>
          <input
            ref={inputRef}
            id="lg-code"
            className={`lg-input${shake ? ' lg-shake' : ''}`}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
            onAnimationEnd={() => setShake(false)}
            aria-invalid={invalid}
            aria-describedby="lg-msg"
          />
          <p id="lg-msg" className="lg-msg" role="alert" data-testid="login-message">{error}</p>
          <button type="submit" className="lg-go" disabled={!password || state !== 'idle'}>
            <span>{state === 'checking' ? 'Checking…' : state === 'granted' ? 'Access granted' : 'Access Terminal'}</span>
            <span className="arrow" aria-hidden="true">{state === 'granted' ? '✓' : '→'}</span>
          </button>
        </form>

        <div className="lg-readout" data-testid="login-readout">
          <span><b>{etTime}</b></span>
          <span>{COORDS}</span>
          <span>
            <i className="lg-dot" style={{ background: phase?.tone ?? '#5A5A64' }} aria-hidden="true" />
            {phase?.label ?? 'Market'}
          </span>
        </div>
        <div className="lg-foot">Private · Authorized access only</div>
      </section>
    </main>
  );
}
