import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { InviteForm } from '@/components/invite/invite-form';
import { MembersTable } from '@/components/members/members-table';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listMembers } from '@/server/services/members';
import { listPendingInvitations, listTeamsForInvite } from '@/server/services/invitations';
import { isAway } from '@/lib/availability';
import { todayIn } from '@/lib/workspace-date';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  // §10: "Invite / remove members, change roles" is Owner and Admin. A Member
  // reaching this URL gets a 404 rather than a disabled screen — the page has
  // nothing to show them, and a greyed-out control is an invitation to ask why.
  const canManage = can(resolved.actor, 'workspace.manage_members');
  if (!canManage) notFound();

  // §7.13, and a *different* §10 row from the one above — `view_as_member`. It
  // resolves false inside an active session as well, because the resolved actor
  // is then the target and every action is a mutation to a read-only actor:
  // §7.13 has one Exit, not a stack of them.
  const canViewAs = can(resolved.actor, 'workspace.view_as_member');

  const [members, invitations, teams, t] = await Promise.all([
    listMembers(resolved.context),
    listPendingInvitations(resolved.context),
    listTeamsForInvite(resolved.context),
    getTranslations(),
  ]);

  // The **workspace's** today (§17-13). The badge on a row and the arithmetic on
  // §7.4's workload must agree about who is away, and they only can if both ask
  // the same zone.
  const today = todayIn(resolved.workspace.timezone);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('members.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('onboarding.invite.subtitle')}</p>
      </header>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('members.invite')}
        </h2>
        <InviteForm workspaceSlug={workspaceSlug} teams={teams} />
      </section>

      <MembersTable
        workspaceSlug={workspaceSlug}
        members={members.map((m) => ({
          memberId: m.memberId,
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          unavailableUntil: m.unavailableUntil,
          unavailableReason: m.unavailableReason,
          // Resolved here, against the **workspace's** today (§17-13), so the
          // badge and §7.4's capacity arithmetic answer "is this person away"
          // the same way — one function, `isAway`, in `src/lib/availability.ts`.
          away: isAway(m, today),
          // §20.5: the offboarding dialog says how many private notes go with
          // them, before the click. A number, never a list.
          noteCount: m.noteCount,
          pageCount: m.pageCount,
          // §21.3: and how many pages lose their owner, which is the one of
          // the three somebody can still do something about.
          ownedPageCount: m.ownedPageCount,
        }))}
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          deliveryStatus: i.deliveryStatus,
        }))}
        currentUserId={resolved.user.id}
        canManage={canManage}
        canViewAs={canViewAs}
        today={today}
      />
    </div>
  );
}
