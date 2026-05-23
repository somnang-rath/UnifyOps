'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { useAuthStore } from '@/stores/auth-store';
import { hydratePrefs } from '@/lib/auth';
import { refreshAuth } from '@/lib/api';
import { createQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => createQueryClient());
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Use the shared refreshAuth() so a simultaneous call from the
    // interceptor or another effect is de-duplicated into one request.
    refreshAuth()
      .then((token) => {
        if (cancelled || !token) return;
        const user = useAuthStore.getState().user;
        if (user) hydratePrefs(user);
      })
      .finally(() => {
        if (!cancelled) setBooted(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) return null;

  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
