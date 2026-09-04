import { getTranslations } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { appIcons, THEME_COLOR_LIGHT } from '@/lib/app-icons';

/**
 * §4's **Installable** row, §5's "Add to Home Screen", and §15-8's pass
 * condition: "Launches standalone with the right name and icon, **in both
 * locales**."
 *
 * **One manifest per locale, which is why this is a route rather than Next's
 * `app/manifest.ts` convention.** A manifest is a single static document, and
 * its `name` is what a person reads under the icon on their home screen — so a
 * single one would put the app on a Khmer phone under an English name, and
 * §13's rule is that Khmer is never the degraded path. `start_url` and `scope`
 * carry the locale too, so the installed app opens in the language it was
 * installed from and stays inside it. That matters more here than anywhere in
 * the browser: `localePrefix: 'always'` means the locale *is* the URL, and a
 * standalone window has no address bar to correct it with.
 *
 * `id` is pinned per locale, so installing from `/km` after `/en` is a second
 * app rather than an update that silently renames the first.
 *
 * The proxy does not see this path — its matcher excludes anything containing a
 * dot — so it is served directly by the App Router, and the `[locale]` segment
 * is validated here rather than by the proxy that usually does it.
 */
export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return new Response(null, { status: 404 });
  }

  const t = await getTranslations({ locale, namespace: 'app' });

  const manifest = {
    id: `/${locale}`,
    name: t('name'),
    short_name: t('name'),
    description: t('tagline'),
    lang: locale,
    dir: 'ltr',
    // §7.3: the app opens on My Work. `/workspaces` resolves that for itself —
    // straight through to the single workspace, to the picker when there are
    // several, to onboarding when there are none, and to sign-in when there is
    // no session. A launcher icon that lands on a marketing page is an icon
    // people delete.
    start_url: `/${locale}/workspaces`,
    scope: `/${locale}`,
    display: 'standalone',
    // §2.5-3's phone-heavy market. A tracker is a reading surface held in one
    // hand; nothing in it wants a landscape lock.
    orientation: 'portrait-primary',
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    icons: appIcons(),
  };

  return Response.json(manifest, {
    headers: {
      'content-type': 'application/manifest+json',
      // Long enough that a launch does not re-fetch it, short enough that a
      // rename reaches an installed app the same day.
      'cache-control': 'public, max-age=3600',
    },
  });
}
