import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { AvailabilityForm } from '@/components/members/availability-form';
import { resolveActorContext } from '@/server/auth/context';
import { listMembers } from '@/server/services/members';
import { isAway } from '@/lib/availability';
import { todayIn } from '@/lib/workspace-date';

/**
 * A member's own availability (§4, §7.4, §17-25).
 *
 * Beside `settings/notifications`, and for the reason that page's comment gives:
 * it is "the one settings screen that is the member's own rather than the
 * company's, and a preference page an Admin has to unlock is a preference page
 * nobody finds." Marking yourself away is the same kind of thing — it is a fact
 * about you, and needing to ask an Admin to record it is how the flag ends up
 * never being set and §7.4's workload ends up confidently wrong.
 *
 * An Admin can still set somebody else's, from the member list. Same component,
 * same action, and the rule about who may do which lives in `setAvailability`
 * rather than in two copies of a permission check.
 *
 * **It is not in §6's seven customization areas and does not claim to be.** §6-1
 * is company settings; this is one row of one person's membership. It is here
 * because settings is where a person looks for a switch about themselves, not
 * because availability is a company preference.
 */
export default async function AvailabilitySettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const t = await getTranslations();
  const members = await listMembers(resolved.context);
  const me = members.find((member) => member.memberId === resolved.memberId);
  if (!me) notFound();

  // The **workspace's** today (§17-13), not the browser's: somebody setting
  // leave from an airport in another zone must get the same answer their
  // manager's workload screen will.
  const today = todayIn(resolved.workspace.timezone);
  const away = isAway(me, today);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('availability.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('availability.description')}</p>
      </header>

      {/*
        §11: a status is stated, never inferred from an empty field. "You are
        available" is a real answer, and the screen says it rather than leaving
        a blank date to mean it.
      */}
      <Alert tone={away ? 'warning' : 'info'}>
        {away && me.unavailableUntil
          ? t('availability.statusAway', { date: me.unavailableUntil })
          : t('availability.statusHere')}
      </Alert>

      <AvailabilityForm
        workspaceSlug={workspaceSlug}
        locale={locale}
        memberId={me.memberId}
        today={today}
        unavailableUntil={me.unavailableUntil}
        unavailableReason={me.unavailableReason}
      />

      {/*
        §3 and §17-25 both draw a hard line here, and it belongs on the screen
        rather than only in a comment: this is a flag, not time tracking. Saying
        so is what stops the next request being "can it track how many days I
        have left".
      */}
      <p className="text-xs text-text-subtle">{t('availability.notTimeTracking')}</p>
    </div>
  );
}
