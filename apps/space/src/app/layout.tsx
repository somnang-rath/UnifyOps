import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono, Kantumruy_Pro } from 'next/font/google';
import { LOCALE_HEADER, LocaleProvider, toLocale } from '@prism/i18n';
import './globals.css';

// Same type family as web/admin — a published page should look like it came
// from the product, because it did (docs/plan/02). Kantumruy Pro covers Khmer.
// next/font self-hosts the files at build, so they load under the Space's
// strict CSP (font-src 'self').
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

export const metadata: Metadata = {
  title: 'Prism · Space',
  description: 'Published content from Prism',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved in middleware (ADR 0016 §2.2). Anonymous visitors have no user
  // record, so the chain here is cookie → Accept-Language → en.
  //
  // ADR 0016 §3.3 flagged this as the one place locale detection might cost
  // something, since `headers()` opts a route out of static rendering. It does
  // not: `[anchor]/page.tsx` is already `dynamic = 'force-dynamic'` and every
  // fetch is `cache: 'no-store'`, because published content must reflect an
  // unpublish immediately. Nothing here was static to lose.
  const locale = toLocale(headers().get(LOCALE_HEADER));

  return (
    <html lang={locale}>
      <body
        className={`${inter.variable} ${mono.variable} ${kantumruy.variable} font-sans`}
      >
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
