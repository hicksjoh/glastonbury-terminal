'use client';
import { useEffect, useState, useCallback } from 'react';

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'g d', label: 'Dashboard' },
      { keys: 'g t', label: 'Trading' },
      { keys: 'g k', label: 'Keisha AI' },
      { keys: 'g w', label: 'Watchlist' },
      { keys: 'g n', label: 'News' },
      { keys: 'g s', label: 'Stock Screener' },
      { keys: 'g r', label: 'Risk' },
      { keys: 'g a', label: 'Alerts' },
      { keys: 'g j', label: 'Journal' },
      { keys: 'g m', label: 'Monte Carlo' },
      { keys: 'g p', label: 'Pairs Trading' },
      { keys: 'g e', label: 'Earnings Intel' },
      { keys: 'g x', label: 'Settings' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: 'Cmd K', label: 'Command Bar' },
      { keys: 'Cmd B', label: 'Toggle Compact Sidebar' },
      { keys: '?', label: 'Show Shortcuts' },
      { keys: 'Esc', label: 'Close Modals' },
    ],
  },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onShow() { setOpen(true); }
    function onCloseAll() { setOpen(false); }
    document.addEventListener('show-shortcuts-help', onShow);
    document.addEventListener('close-all-modals', onCloseAll);
    return () => {
      document.removeEventListener('show-shortcuts-help', onShow);
      document.removeEventListener('close-all-modals', onCloseAll);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1a1a24',
          border: '1px solid #2a2a3a',
          borderRadius: 12,
          padding: '28px 32px',
          maxWidth: 560,
          width: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}>
          <h2 style={{
            color: '#e8e8e8',
            fontSize: 16,
            fontWeight: 600,
            margin: 0,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b6b80',
              cursor: 'pointer',
              fontSize: 18,
              padding: '4px 8px',
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 24 }}>
            <div style={{
              color: '#c9a84c',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 10,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {group.title}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 24px',
            }}>
              {group.shortcuts.map((s) => (
                <div
                  key={s.keys}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                  }}
                >
                  <span style={{ color: '#6b6b80', fontSize: 12 }}>{s.label}</span>
                  <span style={{
                    display: 'inline-flex',
                    gap: 4,
                  }}>
                    {s.keys.split(' ').map((k, i) => (
                      <kbd
                        key={i}
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid #2a2a3a',
                          borderRadius: 4,
                          padding: '2px 7px',
                          fontSize: 11,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: '#e8e8e8',
                          minWidth: 22,
                          textAlign: 'center',
                          lineHeight: '18px',
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{
          color: '#444',
          fontSize: 10,
          textAlign: 'center',
          paddingTop: 8,
          borderTop: '1px solid #2a2a3a',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          Press <kbd style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid #2a2a3a',
            borderRadius: 3,
            padding: '1px 5px',
            fontSize: 10,
            color: '#6b6b80',
          }}>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
