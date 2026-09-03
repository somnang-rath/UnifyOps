import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PreferencesGrid } from '@/components/notifications/preferences-grid';
import { resolveActorContext } from '@/server/auth/context';
import { getNotificationPreferences } from '@/server/services/notifications';
import { saveNotificationPreferenceAction } from './actions';

/**
 * §6-6's per-user notification preferences.
 *
 * Under `settings/` beside labels and members, but unlike either of those it is
 * **not** an administrator's screen: every member has one, and it changes only
 * their own delivery. That is why there is no `can(...)` here and no gate in
 * the navigation — a preference screen an Admin has to grant access to is a
 * preference screen nobody uses.
 *
 * §6-6 also names workspace-level defaults. Those are slice 15's, with the rest
 * of company settings, and nothing here pre-empts them: the defaults this
 * screen falls back to live in `src/lib/notification-kinds.ts`, which is where
 * a workspace-level override would later read from.
 */
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, rows] = await Promise.all([
    getTranslations('notificationSettings'),
    getNotificationPreferences(resolved),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="text-sm text-text-muted">{t('description')}</p>
      </div>

      <PreferencesGrid
        rows={rows}
        onSave={async (kind, channels) => {
          'use server';
          return saveNotificationPreferenceAction(workspaceSlug, locale, kind, channels);
        }}
      />
    </div>
  );
}
