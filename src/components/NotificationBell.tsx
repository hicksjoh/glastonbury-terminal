'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useNotifications, Notification } from '@/contexts/NotificationProvider';

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const priorityColor = (p: string) => {
    if (p === 'P0') return '#f87171';
    if (p === 'P1') return '#f0c674';
    return '#8888a8';
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        aria-label="Notifications"
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          padding: 8, color: unreadCount > 0 ? '#f0c674' : '#555570',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#f87171', color: '#fff', fontSize: 9, fontWeight: 700,
            borderRadius: '50%', width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, width: 360,
          background: '#1a1a24', border: '1px solid #1e1e35', borderRadius: 12,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)', zIndex: 1000,
          maxHeight: 420, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #1e1e35',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: '#e8e8f0', fontWeight: 600, fontSize: 13 }}>Notifications</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#8a5cf6', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Check size={12} /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: '#555570', padding: 0,
              }}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#555570', fontSize: 13 }}>
                No notifications yet
              </div>
            ) : (
              notifications.slice(0, 20).map((n: Notification) => (
                <div
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    if (n.link) window.location.href = n.link;
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid rgba(30,30,53,0.5)',
                    cursor: 'pointer', background: n.read ? 'transparent' : 'rgba(138,92,246,0.04)',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: n.read ? 'transparent' : priorityColor(n.priority),
                    }} />
                    <span style={{ color: '#e8e8f0', fontSize: 13, fontWeight: n.read ? 400 : 600 }}>
                      {n.title}
                    </span>
                    <span style={{ color: '#555570', fontSize: 10, marginLeft: 'auto' }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.message && (
                    <div style={{ color: '#8888a8', fontSize: 12, paddingLeft: 14 }}>
                      {n.message}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
