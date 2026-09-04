import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PreferencesGrid } from '@/components/notifications/preferences-grid';
import { Alert } from '@/components/ui/feedback';
import { resolveActorContext } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { getWorkspaceNotificationDefaults } from '@/server/services/notifications';
import { saveWorkspaceNotificationDefaultAction } from './actions';

/**
 * §6-6's other half: what a member gets **before** they have chosen anything.
 *
 * Slice 9 built the per-user preferences and its page comment named this screen
 * as slice 15's. The grid is literally the same component — the two screens are
 * one grid asked about different rows, and a second one would be a second place
 * to get the digest's email-only rule wrong.
 *
 * **These are defaults, not policy**, and the page says so: a member's own
 * choice still wins. §6-6 puts per-user preferences in v1 and the rules engine
 * that could overrule them in Phase 2, and a company able to force email on
 * somebody has built the thing §7.8 says teaches a team to filter the product's
 * mail.
 */
export default async function NotificationDefaultsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  assertCan(resolved.actor, 'workspace.settings');

  const [t, rows] = await Promise.all([
    getTranslations(),
    getWorkspaceNotificationDefaults(resolved),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('settings.sections.notificationDefaults')}
        </h2>
        <p className="text-sm text-text-muted">{t('settings.notificationDefaults.subtitle')}</p>
      </header>

      <Alert>{t('settings.notificationDefaults.memberWins')}</Alert>

      <PreferencesGrid
        rows={rows}
        onSave={async (kind, channels) => {
          'use server';
          return saveWorkspaceNotificationDefaultAction(workspaceSlug, locale, kind, channels);
        }}
      />
    </div>
  );
}
