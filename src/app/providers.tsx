'use client';

import { ReactNode } from 'react';
import { RealtimeProvider } from '@/contexts/RealtimeProvider';
import { NotificationProvider } from '@/contexts/NotificationProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <NotificationProvider>
        {children}
      </NotificationProvider>
    </RealtimeProvider>
  );
}
