import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BrandingForm } from '@/components/settings/branding-form';
import { resolveActorContext } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { getWorkspaceSettings } from '@/server/services/workspace-settings';
import { logoUrl } from '@/server/services/workspace-logo';

/**
 * §6-7's screen.
 *
 * The one settings page with **no read-only variant**: an accent and a logo are
 * only interesting to somebody who can change them, and a Member shown a
 * disabled colour picker would go looking for the permission that enables it.
 * `assertCan` rather than a `can` branch, so the answer is the 403 the layout's
 * nav already implied by not linking here.
 *
 * §6-7 also names "login page" and "email header". Neither is built, and both
 * are named in CLAUDE.md rather than hidden: the login page is pre-tenancy — it
 * renders before any workspace is known, so there is nothing to brand it *with*
 * — and the email header needs the parent Unify mark, which is not in the repo
 * (see CLAUDE.md's "the logo is the exception").
 *
 * **Slice 16 added a third item to that same list**, and it is worth knowing
 * here because this is the screen somebody visits when they wonder what the
 * product looks like: the **app icon set** is missing for the same reason the
 * email header is. §15-8's install pass is otherwise complete — manifest,
 * per-locale name, standalone display, scope, theme colour — and `icons` is
 * deliberately empty rather than filled with a placeholder, which means Chrome
 * declines to offer installation. `src/lib/app-icons.ts` is the whole of it and
 * carries the reasoning. Note that a *company's* logo, which this screen
 * uploads, is a different asset entirely and works today.
 */
export default async function BrandingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  assertCan(resolved.actor, 'workspace.settings');

  const [t, settings] = await Promise.all([getTranslations(), getWorkspaceSettings(resolved)]);
  if (!settings) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('settings.sections.branding')}
        </h2>
        <p className="text-sm text-text-muted">{t('settings.branding.subtitle')}</p>
      </header>

      <BrandingForm
        workspaceSlug={workspaceSlug}
        accent={settings.accent}
        logoUrl={settings.logoKey ? logoUrl(settings.logoKey) : null}
      />
    </div>
  );
}
