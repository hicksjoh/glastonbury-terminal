'use client';

import { createContext, useContext, useEffect, useRef, useCallback, useState, ReactNode } from 'react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

type EventType = 'trade_executed' | 'alert_triggered' | 'agent_action' | 'regime_change' | 'keisha_recommendation' | 'notification';
type EventCallback = (payload: Record<string, unknown>) => void;

interface RealtimeContextType {
  subscribe: (event: EventType, callback: EventCallback) => () => void;
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeContextType>({
  subscribe: () => () => {},
  connected: false,
});

export function useRealtimeEvent(eventType: EventType, callback: EventCallback) {
  const { subscribe } = useContext(RealtimeContext);
  useEffect(() => {
    return subscribe(eventType, callback);
  }, [eventType, callback, subscribe]);
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<EventType, Set<EventCallback>>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const supabase = createClient(url, key);

    // Listen to notifications table for real-time updates
    const channel = supabase
      .channel('terminal-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        emit('notification', payload.new as Record<string, unknown>);
        const type = (payload.new as Record<string, unknown>).type as string;
        if (type === 'alert') emit('alert_triggered', payload.new as Record<string, unknown>);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_actions' }, (payload) => {
        emit('agent_action', payload.new as Record<string, unknown>);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'market_regime' }, (payload) => {
        emit('regime_change', payload.new as Record<string, unknown>);
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function emit(event: EventType, payload: Record<string, unknown>) {
    const callbacks = listenersRef.current.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(payload));
    }
  }

  const subscribe = useCallback((event: EventType, callback: EventCallback) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    return () => {
      listenersRef.current.get(event)?.delete(callback);
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ subscribe, connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}
