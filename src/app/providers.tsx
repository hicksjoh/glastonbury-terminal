'use client';

import { ReactNode } from 'react';
import { RealtimeProvider } from '@/contexts/RealtimeProvider';
import { NotificationProvider } from '@/contexts/NotificationProvider';
import { PriceProvider } from '@/contexts/PriceContext';
import { ToastProvider } from '@/components/Toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <NotificationProvider>
        <PriceProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </PriceProvider>
      </NotificationProvider>
    </RealtimeProvider>
  );
}
