import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InviteForm } from '@/components/invite/invite-form';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listTeamsForInvite } from '@/server/services/invitations';
import { Link } from '@/i18n/navigation';

/**
 * The invite step of §7.1's signup path.
 *
 * The same form as the settings screen, with one difference that the plan is
 * explicit about: **"Skip" is visually equal to "Send"**. Not a link under the
 * button, not smaller, not grey. The whole claim of the path is that no
 * configuration step exists in it, and an invite step that reads as mandatory
 * is a configuration step.
 */
export default async function OnboardingInvitePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();
  if (!can(resolved.actor, 'workspace.manage_members')) notFound();

  const [teams, t] = await Promise.all([
    listTeamsForInvite(resolved.context),
    getTranslations(),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('onboarding.invite.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('onboarding.invite.subtitle')}</p>
      </header>

      <InviteForm
        workspaceSlug={workspaceSlug}
        teams={teams}
        onSkip={
          <Link
            href={`/${workspaceSlug}`}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-surface-hover"
          >
            {t('onboarding.invite.skip')}
          </Link>
        }
      />
    </div>
  );
}
