import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono, Kantumruy_Pro, Koh_Santepheap } from 'next/font/google';
import { LOCALE_HEADER, toLocale } from '@prism/i18n';
import { ThemeBootScript } from '@/components/layout/theme-boot-script';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});
const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-khmer',
});
const kohSantepheap = Koh_Santepheap({
  subsets: ['khmer', 'latin'],
  weight: ['300', '400', '700'],
  variable: '--font-koh-santepheap',
});

export const metadata: Metadata = {
  title: 'UnifyOps',
  description:
    'Plan, build, and ship — all in one beautiful workspace.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved once, in middleware (ADR 0016 §2.2). Reading it here rather than
  // detecting on the client is what makes the first server-rendered HTML
  // already correct — no flash of English, no hydration mismatch.
  const locale = toLocale(headers().get(LOCALE_HEADER));

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeBootScript />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${kantumruy.variable} ${kohSantepheap.variable} font-sans`}>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
