import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CompanyForm } from '@/components/settings/company-form';
import { Alert } from '@/components/ui/feedback';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { getWorkspaceSettings } from '@/server/services/workspace-settings';

/**
 * §6-1's screen — the first of the seven, and the one the plan lists first.
 *
 * `timezone` and `working_days` have been columns since slices 5 and 9, both
 * carrying a comment saying the screen that edits them was slice 15's. This is
 * that screen; `week_start` and `default_locale` arrive with it.
 *
 * A Member sees the values and is told why they cannot change them, rather than
 * a page with the controls quietly missing — the same shape the labels screen
 * chose, and for the same reason: an absent control is a bug report, an
 * explained one is an answer.
 */
export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, settings] = await Promise.all([
    getTranslations(),
    getWorkspaceSettings(resolved),
  ]);

  if (!settings) notFound();

  const canManage = can(resolved.actor, 'workspace.settings');

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('settings.sections.general')}
        </h2>
        <p className="text-sm text-text-muted">{t('settings.company.subtitle')}</p>
      </header>

      {canManage ? (
        <CompanyForm workspaceSlug={workspaceSlug} settings={settings} />
      ) : (
        <>
          <Alert>{t('settings.readOnly')}</Alert>
          <dl className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface text-sm">
            <ReadOnlyRow label={t('settings.company.name')} value={settings.name} />
            <ReadOnlyRow label={t('settings.company.slug')} value={settings.slug} />
            <ReadOnlyRow label={t('settings.company.timezone')} value={settings.timezone} />
          </dl>
        </>
      )}
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2">
      <dt className="w-32 shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
