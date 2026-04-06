'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SHORTCUTS: Record<string, string> = {
  'g+d': '/',           // Go to Dashboard
  'g+t': '/trading',    // Go to Trading
  'g+k': '/keisha',     // Go to Keisha
  'g+w': '/watchlist',  // Go to Watchlist
  'g+n': '/news',       // Go to News
  'g+s': '/screener',   // Go to Screener
  'g+r': '/risk',       // Go to Risk
  'g+a': '/alerts',     // Go to Alerts
  'g+j': '/journal',    // Go to Journal
  'g+m': '/monte-carlo', // Go to Monte Carlo
  'g+p': '/pairs',      // Go to Pairs
  'g+e': '/earnings',   // Go to Earnings
  'g+x': '/settings',   // Go to Settings
};

export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let firstKey = '';
    let timeout: NodeJS.Timeout;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).contentEditable === 'true') return;

      // Cmd+K already handled by CommandBar
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') return;

      const key = e.key.toLowerCase();

      // Two-key combos (g + letter)
      if (firstKey) {
        const combo = `${firstKey}+${key}`;
        if (SHORTCUTS[combo]) {
          e.preventDefault();
          router.push(SHORTCUTS[combo]);
        }
        firstKey = '';
        clearTimeout(timeout);
        return;
      }

      // Start a combo
      if (key === 'g') {
        firstKey = 'g';
        timeout = setTimeout(() => { firstKey = ''; }, 500);
        return;
      }

      // Single key shortcuts
      if (key === '?' && !e.metaKey && !e.ctrlKey) {
        // Show shortcuts help
        document.dispatchEvent(new CustomEvent('show-shortcuts-help'));
      }

      if (key === 'escape') {
        document.dispatchEvent(new CustomEvent('close-all-modals'));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [router]);
}
