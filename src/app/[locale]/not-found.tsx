import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * §15-2's pass condition, given a face.
 *
 * "Paste workspace B's URL while signed in as A → **404, not an empty page**."
 * Every `notFound()` in the product already produced a 404; what it produced on
 * screen was Next's own untranslated English default, which in a Khmer session
 * is the one screen in the product that is not in the reader's language — §13's
 * "Khmer is never the degraded path" fails at exactly the moment somebody is
 * already confused.
 *
 * The copy is deliberately **one sentence covering four causes** — moved,
 * deleted, never existed, or another company's. The workspace layout 404s a
 * non-member on purpose so an outsider cannot learn which company slugs exist,
 * and a message that distinguished "no such workspace" from "not yours" would
 * hand back exactly what that 404 is withholding.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations();

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16"
    >
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('errors.notFoundTitle')}
        </h1>
        <p className="text-sm text-text-muted">{t('errors.notFoundBody')}</p>
      </div>

      {/* `/workspaces` rather than `/`: a 404 page has no workspace slug to
          send anyone to, and this is the one route that resolves that for
          itself — it redirects to sign-in when there is no session, to
          onboarding when there is no company, and otherwise shows the picker.
          The landing page would be the product losing somebody who is already
          signed in. */}
      <Link
        href="/workspaces"
        className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
      >
        {t('errors.notFoundAction')}
      </Link>
    </main>
  );
}
