'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
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
  alertBadgeCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'created_at'>) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  alertBadgeCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  addNotification: () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

export function useAlertBadge() {
  const { alertBadgeCount } = useContext(NotificationContext);
  return alertBadgeCount;
}

const ALERT_CHECK_INTERVAL = 60_000; // 60 seconds

// Simple check: is US market likely open? (weekday, 9:30am-4pm ET)
function isMarketHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 570 && totalMinutes <= 960; // 9:30 AM to 4:00 PM
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [alertBadgeCount, setAlertBadgeCount] = useState(0);
  const alertCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load notifications on mount
  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => {
        if (d.success) setNotifications(d.data || []);
      })
      .catch(() => {});
  }, []);

  // Request browser notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
      window.Notification.requestPermission();
    }
  }, []);

  // Periodic alert checking during market hours
  useEffect(() => {
    const checkAlerts = async () => {
      // Check even outside market hours but less critical
      try {
        const res = await fetch('/api/alerts/check');
        if (!res.ok) return;
        const data = await res.json();

        if (data.triggered && data.triggered.length > 0) {
          setAlertBadgeCount(prev => prev + data.triggered.length);

          for (const alert of data.triggered) {
            // Add to in-app notifications
            const newNotif: Notification = {
              id: crypto.randomUUID(),
              type: 'alert',
              priority: 'P1',
              title: `Alert: ${alert.name}`,
              message: alert.conditions
                .map((c: { symbol: string; metric: string; operator: string; value: number }) =>
                  `${c.symbol} ${c.metric} ${c.operator} ${c.value}`
                )
                .join(' & '),
              read: false,
              link: '/alerts',
              created_at: new Date().toISOString(),
            };
            setNotifications(prev => [newNotif, ...prev]);
            showToast(newNotif);

            // Browser push notification
            if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
              new window.Notification(`Alert: ${alert.name}`, {
                body: newNotif.message || '',
                icon: '/glastonbury-logo.png',
                tag: `alert-${alert.id}`,
              });
            }
          }
        }
      } catch {
        // silent fail
      }
    };

    // Check immediately on mount if during market hours
    if (isMarketHours()) {
      checkAlerts();
    }

    alertCheckTimerRef.current = setInterval(() => {
      // Always check, but the real value is during market hours
      checkAlerts();
    }, ALERT_CHECK_INTERVAL);

    return () => {
      if (alertCheckTimerRef.current) clearInterval(alertCheckTimerRef.current);
    };
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
    if (n.priority === 'P0' && typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
      new window.Notification(n.title, { body: n.message || '', icon: '/glastonbury-logo.png' });
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
    <NotificationContext.Provider value={{ notifications, unreadCount, alertBadgeCount, markRead, markAllRead, addNotification }}>
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
