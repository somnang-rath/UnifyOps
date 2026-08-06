'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { LocaleProvider, type Locale } from '@prism/i18n';
import { Toaster } from '@/components/ui/toaster';
import { useAuthStore } from '@/stores/auth-store';
import { hydratePrefs } from '@/lib/auth';
import { refreshAuth } from '@/lib/api';
import { createQueryClient } from '@/lib/query-client';

export function Providers({
  locale,
  children,
}: {
  /** Resolved server-side in middleware and passed down — never detected here. */
  locale: Locale;
  children: React.ReactNode;
}) {
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
        if (!user) return;
        // Restoring a session on the page the user is already looking at. If
        // their account language disagrees with what the server rendered, only
        // a real request can fix the shell — and unlike the login path, nothing
        // is navigating here, so reloading is safe.
        if (hydratePrefs(user)) window.location.reload();
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
    <LocaleProvider locale={locale}>
      <QueryClientProvider client={qc}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </LocaleProvider>
  );
}
