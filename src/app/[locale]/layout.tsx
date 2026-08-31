import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  IBM_Plex_Sans,
  IBM_Plex_Sans_Condensed,
  Kantumruy_Pro,
  Koh_Santepheap,
} from 'next/font/google';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/theme-provider';
import '../globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const condensed = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-condensed',
  display: 'swap',
});

// §18-2 settled the split: Koh Santepheap is the brand Khmer face but is
// display-weight, so it carries headings only. Kantumruy Pro carries body
// text, where at 12–14px it is materially more legible.
const khmer = Kantumruy_Pro({
  subsets: ['khmer'],
  weight: ['400', '500', '600'],
  variable: '--font-khmer',
  display: 'swap',
});

const khmerDisplay = Koh_Santepheap({
  subsets: ['khmer'],
  weight: ['400', '700'],
  variable: '--font-khmer-display',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Enables static rendering for this locale segment.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${condensed.variable} ${khmer.variable} ${khmerDisplay.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
