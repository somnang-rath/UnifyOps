'use client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider, type Locale } from '@prism/i18n';
import { ThemeProvider } from '@/components/theme';

export function Providers({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: (n, e: any) =>
              n < 2 && e?.response?.status !== 401 && e?.response?.status !== 403,
          },
        },
      }),
  );
  return (
    <LocaleProvider locale={locale}>
      <ThemeProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}
