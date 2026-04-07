'use client';

import { ReactNode, useEffect } from 'react';
import { RealtimeProvider } from '@/contexts/RealtimeProvider';
import { NotificationProvider, registerToastBridge } from '@/contexts/NotificationProvider';
import { PriceProvider } from '@/contexts/PriceContext';
import { ToastProvider, useToast } from '@/components/Toast';

function ToastBridgeRegistrar({ children }: { children: ReactNode }) {
  const { addToast } = useToast();
  useEffect(() => {
    registerToastBridge(addToast);
    return () => registerToastBridge(null);
  }, [addToast]);
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <ToastProvider>
        <ToastBridgeRegistrar>
          <NotificationProvider>
            <PriceProvider>
              {children}
            </PriceProvider>
          </NotificationProvider>
        </ToastBridgeRegistrar>
      </ToastProvider>
    </RealtimeProvider>
  );
}
