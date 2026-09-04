import type { Metadata, Viewport } from 'next';
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
import { SkipToContent } from '@/components/ui/skip-to-content';
import {
  APPLE_TOUCH_ICON,
  MARK_AVAILABLE,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  favicons,
} from '@/lib/app-icons';
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

/**
 * §4's **Installable** row, browser-chrome half.
 *
 * Two `theme-color` metas rather than one, because the value tints the address
 * bar and the standalone window's chrome — a single light value on a phone in
 * dark mode is a pale bar above a dark app, which is the one visual seam an
 * installed app cannot hide. They are the two palettes' own `--bg`, and they
 * change with layer 2 rather than on their own (see `app-icons.ts`).
 *
 * `colorScheme` is what makes the browser's *own* surfaces — form controls,
 * scrollbars, the space behind a rubber-band scroll — follow the page instead
 * of staying light under `.dark`.
 *
 * Deliberately no `viewportFit: 'cover'`: it is the flag that pushes content
 * under a notch, and it is only safe with safe-area insets applied throughout.
 * The default keeps every screen inside the safe area, which is what §15-6
 * actually asks for.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

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
    // One manifest per locale — see the route for why. The link has to be
    // per-locale too, or every install would take whichever language the single
    // manifest happened to be written in.
    manifest: `/${locale}/manifest.webmanifest`,
    // iOS reads none of the manifest. `capable` is what makes a home-screen
    // launch open without Safari's chrome, and the title is what appears under
    // the icon — from the same catalogue as the manifest's `name`, so the two
    // cannot say different things.
    appleWebApp: { capable: true, title: t('name'), statusBarStyle: 'default' },
    // The tab icon and the iOS touch icon, both declared here rather than
    // left to Next's `app/icon.*` file convention — an explicit `icons` key
    // takes precedence over the convention, so declaring one and relying on
    // the other for the rest is how a favicon silently disappears.
    //
    // Still conditional on the mark existing (see `app-icons.ts`), because a
    // 404 behind `apple-touch-icon` makes iOS render a screenshot of the page
    // as the icon, which looks like a bug rather than like an absence.
    ...(MARK_AVAILABLE
      ? { icons: { icon: [...favicons()], apple: APPLE_TOUCH_ICON } }
      : {}),
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
          {/* §11's keyboard baseline. It is the first focusable thing in the
              document on every screen, which is the only position that makes
              it work — a workspace header carries a logo, five nav links, the
              palette, the bell, two toggles and sign-out, and reaching the
              board past them is nine tab stops on every navigation. */}
          <SkipToContent />
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
