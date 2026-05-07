'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js after window load.
 *
 * Replaces the previous `<script dangerouslySetInnerHTML>` block in
 * src/app/layout.tsx (Codex audit finding #22). The inline script worked
 * but kept dangerouslySetInnerHTML in the codebase as an injection sink
 * pattern, and it required CSP `script-src 'unsafe-inline'` on top of
 * what Next.js itself already needs for hydration.
 *
 * Moving to a client component ships the same logic as a normal hashed
 * bundle file (covered by `script-src 'self'`) and removes one
 * dangerouslySetInnerHTML usage from the codebase.
 *
 * Note: full removal of `'unsafe-inline'` from CSP still requires a
 * nonce-based middleware because Next.js itself emits inline bootstrap
 * scripts. Tracked separately for Week 3.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Match the pre-refactor behavior: register on `load` so we don't
    // contend with the page's first-paint critical path.
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').then(
        (reg) => {
          console.log('[SW] registered, scope:', reg.scope);
        },
        (err) => {
          console.warn('[SW] registration failed:', err);
        },
      );
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
