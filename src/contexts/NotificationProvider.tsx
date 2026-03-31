'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useRealtimeEvent } from './RealtimeProvider';

export interface Notification {
  id: string;
  type: string;
  priority: string;
  title: string;
  message?: string;
  read: boolean;
  link?: string;
  created_at: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'created_at'>) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  addNotification: () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Load notifications on mount
  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => {
        if (d.success) setNotifications(d.data || []);
      })
      .catch(() => {});
  }, []);

  // Listen for realtime notifications
  useRealtimeEvent('notification', useCallback((payload: Record<string, unknown>) => {
    const n = payload as unknown as Notification;
    setNotifications(prev => [n, ...prev]);

    // Show toast for P0 and P1
    if (n.priority === 'P0' || n.priority === 'P1') {
      showToast(n);
    }

    // Browser push for P0
    if (n.priority === 'P0' && Notification.permission === 'granted') {
      new globalThis.Notification(n.title, { body: n.message || '' });
    }
  }, []));

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, read: true }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true, read: true }),
    }).catch(() => {});
  }, []);

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'read' | 'created_at'>) => {
    const newNotif: Notification = {
      ...n,
      id: crypto.randomUUID(),
      read: false,
      created_at: new Date().toISOString(),
    };
    setNotifications(prev => [newNotif, ...prev]);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, addNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

function showToast(n: Notification) {
  // Create a toast element
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    background: #1a1a24; border: 1px solid ${n.priority === 'P0' ? '#f87171' : '#f0c674'};
    border-radius: 12px; padding: 16px 20px; max-width: 380px;
    color: #e8e8f0; font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease; cursor: pointer;
  `;
  toast.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;color:${n.priority === 'P0' ? '#f87171' : '#f0c674'}">${n.title}</div>
    <div style="color:#8888a8">${n.message || ''}</div>
  `;
  toast.onclick = () => toast.remove();
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}
